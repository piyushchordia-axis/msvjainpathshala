/**
 * Minimal type shim for `expo-camera` (added in Step 15 for the Shivir
 * volunteer scanner). The runtime dependency lands when this module is
 * added via `pnpm --filter @jp/mobile add expo-camera` and the
 * post-merge setup script runs `expo install` to align native binaries.
 *
 * The shim mirrors the small surface our scanner consumes — keep it
 * conservative; richer shapes (zoom, flash, focus depth) belong in
 * `@types/expo-camera` once the dep ships.
 */

declare module 'expo-camera' {
  import type { ReactNode } from 'react';
  import type { ViewStyle } from 'react-native';

  export interface BarcodeScanningResult {
    type: string;
    data: string;
    cornerPoints?: Array<{ x: number; y: number }>;
    bounds?: { origin: { x: number; y: number }; size: { width: number; height: number } };
  }

  export interface CameraViewProps {
    style?: ViewStyle;
    facing?: 'front' | 'back';
    barcodeScannerSettings?: { barcodeTypes?: string[] };
    onBarcodeScanned?: (result: BarcodeScanningResult) => void;
    onCameraReady?: () => void;
    children?: ReactNode;
  }

  export const CameraView: React.ComponentType<CameraViewProps>;

  export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

  export interface PermissionResponse {
    status: PermissionStatus;
    granted: boolean;
    canAskAgain: boolean;
  }

  export function useCameraPermissions(): [
    PermissionResponse | null,
    () => Promise<PermissionResponse>,
  ];
}
