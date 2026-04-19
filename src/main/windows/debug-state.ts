export interface DebugState {
  enabled: boolean;
  identifier: string | undefined;
  remoteUrl: string;
  enable(): Promise<void>;
  disable(): void;
}