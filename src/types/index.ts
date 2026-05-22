export type ElementType = 'normal_text' | 'large_text' | 'ui_component';

export interface ContrastElement {
  id: number;
  description: string;
  type: ElementType;
  foregroundColor: string;
  backgroundColor: string;
  contrastRatio: number;
  wcagAA: boolean;
  wcagAAA: boolean;
  location: string;
  boundingBox?: [number, number, number, number];
}

export interface ImageAnalysis {
  summary: string;
  overallPass: boolean;
  elements: ContrastElement[];
}

export interface AnalysisResult {
  id?: number;
  filename: string;
  imageData: string;
  analysis?: ImageAnalysis;
  status?: 'queued' | 'analyzing' | 'done' | 'error';
  created_at?: string;
}

export type UploadStatus = 'idle' | 'uploading' | 'done' | 'error';
