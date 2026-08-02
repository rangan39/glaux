export type ArtifactDownloadState = {
  key: string;
  version: 1;
  size: number;
  sha256: string;
  segmentSize: number;
  etag: string;
  completed: number[];
  status: "partial" | "ready";
};

type ArtifactIdentity = {
  key: string;
  size: number;
  sha256: string;
};

export type ArtifactStateInspection = {
  valid: boolean;
  ready: boolean;
  resumableBytes: number;
};

export function inspectArtifactState(
  state: ArtifactDownloadState | undefined,
  artifact: ArtifactIdentity,
  fileSize: number,
  segmentSize: number
): ArtifactStateInspection {
  if (!state
    || state.version !== 1
    || state.key !== artifact.key
    || state.size !== artifact.size
    || state.sha256 !== artifact.sha256
    || state.segmentSize !== segmentSize
    || !Array.isArray(state.completed)
    || fileSize > artifact.size) return { valid: false, ready: false, resumableBytes: 0 };

  const segmentCount = Math.ceil(artifact.size / segmentSize);
  const unique = new Set(state.completed);
  const valid = unique.size === state.completed.length
    && state.completed.every((index) => Number.isSafeInteger(index)
      && index >= 0
      && index < segmentCount
      && index * segmentSize + getSegmentLength(index, artifact.size, segmentSize) <= fileSize);
  if (!valid) return { valid: false, ready: false, resumableBytes: 0 };

  return {
    valid: true,
    ready: state.status === "ready" && fileSize === artifact.size && unique.size === segmentCount,
    resumableBytes: state.completed.reduce(
      (total, index) => total + getSegmentLength(index, artifact.size, segmentSize),
      0
    )
  };
}

export function getSegmentLength(index: number, size: number, segmentSize: number) {
  return Math.max(0, Math.min(segmentSize, size - index * segmentSize));
}
