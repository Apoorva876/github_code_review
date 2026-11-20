import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  auth,
  FIREBASE_DATABASE_ID,
  FIREBASE_PROJECT_ID,
  FIREBASE_UPGRADE_URL,
  formatFriendlyFirestoreError,
  googleProvider,
  isFirestoreQuotaExceededError,
} from '../firebase';
import { api } from '../services/api';
import {
  bootstrapAndLoadFirestoreWorkspace,
  deleteRepositoryInFirestore,
  replaceWorkspaceInFirestore,
  syncAgentStatsInFirestore,
  syncAnalysisJobInFirestore,
  updateRepositoryAutoReviewInFirestore,
  updateReviewStatusOrFindingsInFirestore,
  updateWorkspaceSettingsInFirestore,
  upsertAgentInFirestore,
  upsertRepositoryInFirestore,
  upsertReviewInFirestore,
  type FirestoreWorkspaceSnapshot,
} from '../services/firestoreSync';
import type {
  AIAgent,
  CodeReview,
  DailyActivityPoint,
  Repository,
  RepositoryAnalysisJob,
  WorkspaceSettings,
} from '../types';

export type CloudSyncStatus = 'local-only' | 'syncing' | 'synced' | 'failed';

export type AuthGateState =
  | 'checking-auth'
  | 'unauthenticated'
  | 'unverified-email'
  | 'initializing-workspace'
  | 'authenticated';

export function resolveAuthGateState(params: {
  authReady: boolean;
  user: Pick<User, 'uid' | 'emailVerified'> | null;
  workspaceInitialized: boolean;
}): AuthGateState {
  if (!params.authReady) return 'checking-auth';
  if (!params.user) return 'unauthenticated';
  if (!params.user.emailVerified) return 'unverified-email';
  if (!params.workspaceInitialized) return 'initializing-workspace';
  return 'authenticated';
}

export function deriveCloudSyncStatus(params: {
  isVerifiedUser: boolean;
  syncing: boolean;
  syncError: string | null;
  hasCompletedCloudSync: boolean;
  lastSyncedAt: string | null;
}): CloudSyncStatus {
  if (params.syncing) return 'syncing';
  if (params.syncError) return 'failed';
  if (params.isVerifiedUser && params.hasCompletedCloudSync && params.lastSyncedAt) {
    return 'synced';
  }
  return 'local-only';
}

const SESSION_EXPIRED_CODES = new Set([
  'auth/user-token-expired',
  'auth/id-token-revoked',
  'auth/user-disabled',
  'auth/invalid-user-token',
]);

function formatFirebaseAuthError(err: unknown): string | null {
  const code = (err as { code?: unknown })?.code;
  if (typeof code !== 'string') return null;
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Google sign-in popup was closed before completing.';
    case 'auth/popup-blocked':
      return 'Popup was blocked by your browser. Please allow popups and try again.';
    case 'auth/network-request-failed':
      return 'Network error while contacting Google Authentication. Check your connection and retry.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for Firebase Google Authentication.';
    case 'auth/too-many-requests':
      return 'Too many sign-in attempts. Please wait a moment and try again.';
    case 'auth/user-token-expired':
    case 'auth/id-token-revoked':
    case 'auth/invalid-user-token':
      return 'Your authentication session has expired. Please sign in again with Google.';
    case 'auth/user-disabled':
      return 'This Google account has been disabled in Firebase Authentication.';
    default:
      return null;
  }
}

export interface FirestoreDocumentCounts {
  repositories: number;
  reviews: number;
  agents: number;
  analysisJobs: number;
}

interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  isVerifiedUser: boolean;
  workspaceInitialized: boolean;
  authGateState: AuthGateState;
  signingIn: boolean;
  syncing: boolean;
  syncStatus: CloudSyncStatus;
  hasCompletedCloudSync: boolean;
  syncError: string | null;
  isQuotaError: boolean;
  firestoreCounts: FirestoreDocumentCounts | null;
  lastSyncedAt: string | null;
  workspaceSyncVersion: number;
  projectId: string;
  databaseId: string;
  upgradeUrl: string;
  signInWithGoogle: () => Promise<void>;
  signOutFirebase: () => Promise<void>;
  clearSyncError: () => void;
  syncNow: () => Promise<void>;
  syncRepository: (repo: Repository) => Promise<void>;
  syncRepositoryAutoReview: (repoId: string, enabled: boolean) => Promise<void>;
  removeRepository: (repoId: string) => Promise<void>;
  syncReviewAndRelated: (review: CodeReview) => Promise<void>;
  syncReviewMutation: (review: CodeReview) => Promise<void>;
  syncAgentMutation: (agent: AIAgent) => Promise<void>;
  syncAnalysisJob: (job: RepositoryAnalysisJob) => Promise<void>;
  syncWorkspaceSettings: (
    settings: Pick<
      WorkspaceSettings,
      | 'organizationName'
      | 'defaultAgentId'
      | 'defaultModel'
      | 'autoPostPrSummary'
      | 'minimumPassScore'
    >,
    dailyActivity?: DailyActivityPoint[]
  ) => Promise<void>;
  syncWorkspaceResetFromExpress: () => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

async function fetchExpressWorkspaceSnapshot(): Promise<FirestoreWorkspaceSnapshot> {
  const [dashRes, reposRes, reviewsRes, agentsRes, settingsRes] = await Promise.all([
    api.getDashboard(),
    api.getRepositories(),
    api.getReviews(),
    api.getAgents(),
    api.getSettings(),
  ]);

  return {
    repositories: reposRes.repositories,
    reviews: reviewsRes.reviews,
    agents: agentsRes.agents,
    analysisJobs: [],
    dailyActivity: dashRes.dailyActivity,
    settings: {
      organizationName: settingsRes.settings.organizationName,
      defaultAgentId: settingsRes.settings.defaultAgentId,
      defaultModel: settingsRes.settings.defaultModel,
      autoPostPrSummary: settingsRes.settings.autoPostPrSummary,
      minimumPassScore: settingsRes.settings.minimumPassScore,
    },
  };
}

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [workspaceInitialized, setWorkspaceInitialized] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [hasCompletedCloudSync, setHasCompletedCloudSync] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isQuotaError, setIsQuotaError] = useState(false);
  const [firestoreCounts, setFirestoreCounts] = useState<FirestoreDocumentCounts | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [workspaceSyncVersion, setWorkspaceSyncVersion] = useState(0);

  const hydratedUidRef = useRef<string | null>(null);

  const isVerifiedUser = Boolean(user && user.emailVerified);
  const syncing = pendingSyncCount > 0;
  const authGateState = resolveAuthGateState({
    authReady,
    user,
    workspaceInitialized,
  });
  const syncStatus = deriveCloudSyncStatus({
    isVerifiedUser,
    syncing,
    syncError,
    hasCompletedCloudSync,
    lastSyncedAt,
  });

  const beginSync = useCallback(() => {
    setPendingSyncCount((c) => c + 1);
    setSyncError(null);
    setIsQuotaError(false);
  }, []);

  const finishSync = useCallback(() => {
    setPendingSyncCount((c) => Math.max(0, c - 1));
  }, []);

  const markSyncSuccess = useCallback((counts?: FirestoreDocumentCounts) => {
    setSyncError(null);
    setIsQuotaError(false);
    setHasCompletedCloudSync(true);
    setLastSyncedAt(new Date().toISOString());
    if (counts) {
      setFirestoreCounts(counts);
    }
  }, []);

  const recordFirestoreError = useCallback((err: unknown) => {
    setIsQuotaError(isFirestoreQuotaExceededError(err));
    const authMessage = formatFirebaseAuthError(err);
    setSyncError(authMessage ?? formatFriendlyFirestoreError(err));
  }, []);

  const hydrateForVerifiedUser = useCallback(
    async (firebaseUser: User) => {
      if (!firebaseUser.emailVerified) {
        setHasCompletedCloudSync(false);
        setLastSyncedAt(null);
        setWorkspaceInitialized(false);
        setSyncError(
          'Your Google account email must be verified before writing to Cloud Firestore.'
        );
        return;
      }

      beginSync();
      let sessionValid = true;
      try {
        // Validate active session token (detects revoked/expired sessions on refresh)
        try {
          await firebaseUser.getIdToken();
        } catch (tokenErr) {
          const code = (tokenErr as { code?: unknown })?.code;
          if (typeof code === 'string' && SESSION_EXPIRED_CODES.has(code)) {
            sessionValid = false;
            await signOut(auth).catch(() => undefined);
            setSyncError(
              formatFirebaseAuthError(tokenErr) ??
                'Your authentication session has expired. Please sign in again.'
            );
            return;
          }
        }

        const expressSnapshot = await fetchExpressWorkspaceSnapshot();
        const { isFirstSignIn, workspace } = await bootstrapAndLoadFirestoreWorkspace(
          firebaseUser,
          expressSnapshot
        );

        if (!isFirstSignIn) {
          await api.hydrateWorkspace({
            repositories: workspace.repositories,
            reviews: workspace.reviews,
            agents: workspace.agents,
            analysisJobs: workspace.analysisJobs,
            dailyActivity: workspace.dailyActivity,
            settings: workspace.settings,
            storageMode: 'firebase-firestore',
          });
        } else {
          await api.hydrateWorkspace({
            storageMode: 'firebase-firestore',
          });
        }

        markSyncSuccess({
          repositories: workspace.repositories.length,
          reviews: workspace.reviews.length,
          agents: workspace.agents.length,
          analysisJobs: workspace.analysisJobs.length,
        });
        setWorkspaceSyncVersion((v) => v + 1);
      } catch (err) {
        await api.hydrateWorkspace({ storageMode: 'local-json' }).catch(() => undefined);
        recordFirestoreError(err);
      } finally {
        if (sessionValid) {
          setWorkspaceInitialized(true);
        }
        finishSync();
      }
    },
    [beginSync, finishSync, markSyncSuccess, recordFirestoreError]
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);

      if (nextUser && nextUser.emailVerified) {
        if (hydratedUidRef.current !== nextUser.uid) {
          hydratedUidRef.current = nextUser.uid;
          setWorkspaceInitialized(false);
          setHasCompletedCloudSync(false);
          setLastSyncedAt(null);
          setFirestoreCounts(null);
          void hydrateForVerifiedUser(nextUser);
        }
      } else {
        hydratedUidRef.current = null;
        setWorkspaceInitialized(false);
        setHasCompletedCloudSync(false);
        setFirestoreCounts(null);
        setLastSyncedAt(null);
        if (nextUser && !nextUser.emailVerified) {
          setSyncError(
            'Your Google account email must be verified before accessing CodeRubric.'
          );
        }
      }
    });
    return () => unsubscribe();
  }, [hydrateForVerifiedUser]);

  const signInWithGoogle = useCallback(async () => {
    setSigningIn(true);
    setSyncError(null);
    setIsQuotaError(false);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const authMessage = formatFirebaseAuthError(err);
      if (authMessage) {
        setSyncError(authMessage);
      } else {
        recordFirestoreError(err);
      }
    } finally {
      setSigningIn(false);
    }
  }, [recordFirestoreError]);

  const signOutFirebase = useCallback(async () => {
    setSyncError(null);
    setIsQuotaError(false);
    try {
      hydratedUidRef.current = null;
      setWorkspaceInitialized(false);
      await signOut(auth);
      setHasCompletedCloudSync(false);
      setLastSyncedAt(null);
      setFirestoreCounts(null);
      await api.hydrateWorkspace({ storageMode: 'local-json' }).catch(() => undefined);
      setWorkspaceSyncVersion((v) => v + 1);
    } catch (err) {
      recordFirestoreError(err);
    }
  }, [recordFirestoreError]);

  const syncNow = useCallback(async () => {
    if (!user || !user.emailVerified) return;
    beginSync();
    try {
      const snapshot = await fetchExpressWorkspaceSnapshot();
      const repoResults = await Promise.all(
        snapshot.repositories.map((r) => api.getRepositoryAnalysisJobs(r.id).catch(() => ({ jobs: [] })))
      );
      snapshot.analysisJobs = repoResults.flatMap((res) => res.jobs ?? []).slice(0, 50);

      await replaceWorkspaceInFirestore(user, snapshot);
      await api.hydrateWorkspace({ storageMode: 'firebase-firestore' }).catch(() => undefined);
      markSyncSuccess({
        repositories: snapshot.repositories.length,
        reviews: snapshot.reviews.length,
        agents: snapshot.agents.length,
        analysisJobs: snapshot.analysisJobs.length,
      });
      setWorkspaceSyncVersion((v) => v + 1);
    } catch (err) {
      await api.hydrateWorkspace({ storageMode: 'local-json' }).catch(() => undefined);
      recordFirestoreError(err);
    } finally {
      finishSync();
    }
  }, [user, beginSync, finishSync, markSyncSuccess, recordFirestoreError]);

  const syncRepository = useCallback(
    async (repo: Repository) => {
      if (!user || !user.emailVerified) return;
      beginSync();
      try {
        await upsertRepositoryInFirestore(user.uid, repo);
        markSyncSuccess();
        setFirestoreCounts((prev) =>
          prev ? { ...prev, repositories: prev.repositories + 1 } : prev
        );
      } catch (err) {
        recordFirestoreError(err);
      } finally {
        finishSync();
      }
    },
    [user, beginSync, finishSync, markSyncSuccess, recordFirestoreError]
  );

  const syncRepositoryAutoReview = useCallback(
    async (repoId: string, enabled: boolean) => {
      if (!user || !user.emailVerified) return;
      beginSync();
      try {
        await updateRepositoryAutoReviewInFirestore(user.uid, repoId, enabled);
        markSyncSuccess();
      } catch (err) {
        recordFirestoreError(err);
      } finally {
        finishSync();
      }
    },
    [user, beginSync, finishSync, markSyncSuccess, recordFirestoreError]
  );

  const removeRepository = useCallback(
    async (repoId: string) => {
      if (!user || !user.emailVerified) return;
      beginSync();
      try {
        await deleteRepositoryInFirestore(user.uid, repoId);
        markSyncSuccess();
        setFirestoreCounts((prev) =>
          prev ? { ...prev, repositories: Math.max(0, prev.repositories - 1) } : prev
        );
      } catch (err) {
        recordFirestoreError(err);
      } finally {
        finishSync();
      }
    },
    [user, beginSync, finishSync, markSyncSuccess, recordFirestoreError]
  );

  const syncReviewAndRelated = useCallback(
    async (review: CodeReview) => {
      if (!user || !user.emailVerified) return;
      beginSync();
      try {
        await upsertReviewInFirestore(user.uid, review);
        const [dashRes, reposRes, agentsRes, settingsRes] = await Promise.all([
          api.getDashboard(),
          api.getRepositories(),
          api.getAgents(),
          api.getSettings(),
        ]);

        const matchedRepo = reposRes.repositories.find(
          (r) =>
            r.id === review.repositoryId ||
            r.fullName.toLowerCase() === review.repositoryFullName.toLowerCase()
        );
        if (matchedRepo) {
          await upsertRepositoryInFirestore(user.uid, matchedRepo);
        }

        const matchedAgent = agentsRes.agents.find((a) => a.id === review.agentId);
        if (matchedAgent) {
          await syncAgentStatsInFirestore(user.uid, matchedAgent);
        }

        await updateWorkspaceSettingsInFirestore(
          user.uid,
          settingsRes.settings,
          dashRes.dailyActivity
        );

        markSyncSuccess();
        setFirestoreCounts((prev) =>
          prev ? { ...prev, reviews: prev.reviews + 1 } : prev
        );
      } catch (err) {
        recordFirestoreError(err);
      } finally {
        finishSync();
      }
    },
    [user, beginSync, finishSync, markSyncSuccess, recordFirestoreError]
  );

  const syncReviewMutation = useCallback(
    async (review: CodeReview) => {
      if (!user || !user.emailVerified) return;
      beginSync();
      try {
        await updateReviewStatusOrFindingsInFirestore(user.uid, review);
        markSyncSuccess();
      } catch (err) {
        recordFirestoreError(err);
      } finally {
        finishSync();
      }
    },
    [user, beginSync, finishSync, markSyncSuccess, recordFirestoreError]
  );

  const syncAgentMutation = useCallback(
    async (agent: AIAgent) => {
      if (!user || !user.emailVerified) return;
      beginSync();
      try {
        await upsertAgentInFirestore(user.uid, agent);
        markSyncSuccess();
      } catch (err) {
        recordFirestoreError(err);
      } finally {
        finishSync();
      }
    },
    [user, beginSync, finishSync, markSyncSuccess, recordFirestoreError]
  );

  const syncAnalysisJob = useCallback(
    async (job: RepositoryAnalysisJob) => {
      if (!user || !user.emailVerified) return;
      beginSync();
      try {
        await syncAnalysisJobInFirestore(user.uid, job);
        markSyncSuccess();
      } catch (err) {
        recordFirestoreError(err);
      } finally {
        finishSync();
      }
    },
    [user, beginSync, finishSync, markSyncSuccess, recordFirestoreError]
  );

  const syncWorkspaceSettings = useCallback(
    async (
      settings: Pick<
        WorkspaceSettings,
        | 'organizationName'
        | 'defaultAgentId'
        | 'defaultModel'
        | 'autoPostPrSummary'
        | 'minimumPassScore'
      >,
      dailyActivity?: DailyActivityPoint[]
    ) => {
      if (!user || !user.emailVerified) return;
      beginSync();
      try {
        const activity: DailyActivityPoint[] =
          dailyActivity ?? ((await api.getDashboard()).dailyActivity ?? []);
        await updateWorkspaceSettingsInFirestore(user.uid, settings, activity);
        markSyncSuccess();
      } catch (err) {
        recordFirestoreError(err);
      } finally {
        finishSync();
      }
    },
    [user, beginSync, finishSync, markSyncSuccess, recordFirestoreError]
  );

  const syncWorkspaceResetFromExpress = useCallback(async () => {
    if (!user || !user.emailVerified) return;
    beginSync();
    try {
      const snapshot = await fetchExpressWorkspaceSnapshot();
      await replaceWorkspaceInFirestore(user, snapshot);
      await api.hydrateWorkspace({ storageMode: 'firebase-firestore' });
      markSyncSuccess({
        repositories: snapshot.repositories.length,
        reviews: snapshot.reviews.length,
        agents: snapshot.agents.length,
        analysisJobs: snapshot.analysisJobs.length,
      });
    } catch (err) {
      await api.hydrateWorkspace({ storageMode: 'local-json' }).catch(() => undefined);
      recordFirestoreError(err);
    } finally {
      finishSync();
    }
  }, [user, beginSync, finishSync, markSyncSuccess, recordFirestoreError]);

  const value: FirebaseContextValue = {
    user,
    authReady,
    isVerifiedUser,
    workspaceInitialized,
    authGateState,
    signingIn,
    syncing,
    syncStatus,
    hasCompletedCloudSync,
    syncError,
    isQuotaError,
    firestoreCounts,
    lastSyncedAt,
    workspaceSyncVersion,
    projectId: FIREBASE_PROJECT_ID,
    databaseId: FIREBASE_DATABASE_ID,
    upgradeUrl: FIREBASE_UPGRADE_URL,
    signInWithGoogle,
    signOutFirebase,
    clearSyncError: () => {
      setSyncError(null);
      setIsQuotaError(false);
    },
    syncNow,
    syncRepository,
    syncRepositoryAutoReview,
    removeRepository,
    syncReviewAndRelated,
    syncReviewMutation,
    syncAgentMutation,
    syncAnalysisJob,
    syncWorkspaceSettings,
    syncWorkspaceResetFromExpress,
  };

  return <FirebaseContext.Provider value={value}>{children}</FirebaseContext.Provider>;
}

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used inside a FirebaseProvider');
  }
  return ctx;
}
