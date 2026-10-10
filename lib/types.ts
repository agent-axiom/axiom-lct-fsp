export type Role = 'candidate' | 'employer';
export interface CompetencyResult { skill: string; score: number; correct: number | null; total: number | null; confirmed: boolean }
export interface EvidenceTask { number:number; kind:'applied'|'knowledge'; score:0|1; maxScore:1 }
export interface EvidenceSkill extends CompetencyResult { tasks:EvidenceTask[]|null; applied: {correct:number;total:number}|null; knowledge: {correct:number;total:number}|null }
export interface AssessmentEvidence { source:string; status:'current'|'synthetic'|'stale'|'unavailable'; assessmentId:string|null; completedAt:number|null; bankVersion:number|null; specialization:string; grade:string; score:number|null; totalCorrect:number|null; totalQuestions:number|null; skills:EvidenceSkill[]; limitation:string }
export interface Attempt { id: string; specialization: string; grade: string; score: number | null; passed: boolean; at: number; stale?: boolean; invalidated?: string; competencyResults?: CompetencyResult[] }
export interface FspAchievement { id:string; title:string; provenance:'synthetic_seed'; verified:boolean; specialization:string; grade:string; resultType:'winner'|'finalist'|'participant'; points:number }
export interface Candidate { id: string; name: string; specialization: string; grade: string; score: number; skills: string[]; fsp: boolean; fspAchievements?: FspAchievement[]; achievement?: {bonus:number;maxBonus:number;eligibleCount:number;source:string;limitation:string}; about: string; experience: number; softSkills: string; categoryConfirmed: boolean; competencyResults: CompetencyResult[]; evidenceSource: string; evidence?:AssessmentEvidence; contact?: string; match: number; unverifiedRequirements?: string[]; matchStatus?: 'unverified'|'partial'|'recognized_match'; reasons: string[]; missing: string[] }
export interface User extends Omit<Candidate, 'contact'> { role: Role; email: string; contact: string; verified: boolean; published: boolean; consent: boolean; company: string; description: string; attempts: Attempt[] }
export interface Invitation { id: string; company: string; candidateName: string; salaryFrom: number; salaryTo: number; salaryBasis?: 'gross' | 'net' | 'unspecified'; description: string; employerContact: string; candidateContact?: string; status: 'sent' | 'viewed' | 'accepted' | 'declined' }
export interface Question { id: string; text: string; skill: string; format?: 'text' | 'number'; caseSensitive?: boolean; choices?: string[] }
export interface Assessment { id: string; specialization: string; grade: string; expiresAt: number; questions: Question[] }
export interface SearchFilters { need: string; specialization: string; grade: string; skills: string; fsp: boolean }
export interface Requirements { specialization: string; grade: string; skills: string[]; skillGroups?: string[][]; minExperience: number | null; unverifiedRequirements?: string[]; warnings: string[] }
export interface SearchHistory { id: string; filters: SearchFilters; candidateIds: string[]; at: number }
export interface WorkspaceData { draftIdentity?: string; guest?: {expiresAt:number;ephemeral:boolean;created:boolean}; user: User; invitations: Invitation[]; accounts: Pick<User, 'id' | 'name' | 'role'>[]; outbox: { userId: string; code: string; label: string }[]; searches: SearchHistory[]; test?: Assessment; error?: string }
export interface ActionResult { error?: string; verificationError?: string; candidates: Candidate[]; requirements: Requirements; score: number; message: string; test: Assessment }
export interface ProfileForm { about: string; experience: string | number; softSkills: string; contact: string; published: boolean; consent: boolean }
export interface CompanyForm { company: string; description: string; contact: string }
export interface ModelContext { registerTool(tool: { name: string; description: string; inputSchema: object; annotations: object; execute: (input: unknown) => Promise<unknown> }, options: { signal: AbortSignal }): void | Promise<unknown> }

// Safe email-delivery DTO shared by real-account state and action responses.
export interface AccountEmailState {
 emailStatus?: 'verified'|'blocked'|'queued'|'leased'|'retry'|'sent'|'failed'|'unknown'|'cancelled'|'not_configured'|'not_requested';
 challengeId?: string; expiresAt?: number; emailAttempts?: number;
 emailRetryAllowed?: boolean; emailRetryAt?: number;
}
export type AccountState = Partial<WorkspaceData> & AccountEmailState & {enabled:boolean;enrolled?:boolean;emailEnabled?:boolean;privacyNoticeUrl?:string;privacyNoticeVersion?:string;message?:string};
export type AccountActionResult = AccountEmailState & {error?:string;verificationError?:string;enrolled?:boolean};
