import type { AppData,MealImage,MealRecord } from "../lib/fat-loss";
import type { MealAnalysis } from "../lib/schemas";

// Contracts for the next server phase. No self-hosted adapter is claimed to be running yet.
export type Principal = { id: string; sessionId: string };
export interface AccountService {
  authenticate(request: Request): Promise<Principal>;
  register(email: string,password: string): Promise<void>;
  signIn(email: string,password: string): Promise<Response>;
  signOut(principal: Principal): Promise<void>;
}
export interface SnapshotRepository {
  read(owner: Principal): Promise<{ revision: number; data: AppData }>;
  compareAndSwap(owner: Principal,revision: number,next: AppData): Promise<number>;
  restoreAtomically(owner: Principal,revision: number,next: AppData,photos: MealImage[]): Promise<number>;
}
export interface PrivatePhotoStore {
  read(owner: Principal,id: string): Promise<Blob>;
  stage(owner: Principal,file: Blob): Promise<{ stagedId: string; image: MealImage }>;
  commit(owner: Principal,stagedId: string): Promise<void>;
  listRetained(owner: Principal): AsyncIterable<MealImage>;
}
export interface ModelBudget {
  reserve(owner: Principal,requestId: string): Promise<void>;
  finish(owner: Principal,requestId: string,usage: { input: number; output: number; success: boolean }): Promise<void>;
}
export interface MealAnalysisRepository {
  readMeal(owner: Principal,mealId: string): Promise<MealRecord>;
  saveAnalysis(owner: Principal,mealId: string,analysis: MealAnalysis,expectedUpdatedAt?: string): Promise<MealRecord>;
}

// The production AI route must compose these Oracle-backed ports. The loopback
// test mode deliberately bypasses them and must never be exposed publicly.
export type ProductionAiServices = {
  accounts: AccountService;
  meals: MealAnalysisRepository;
  photos: PrivatePhotoStore;
  budget: ModelBudget;
};
