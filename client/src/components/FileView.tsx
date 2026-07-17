import type { DocSummary } from '../api';

type Props = {
  docId: string;
  meta: DocSummary | null;
};

const formatBytes = (n: number): string => {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const inlineable = (mime: string): 'pdf' | 'iframe' | 'video' | 'audio' | 'text' | 'none' => {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (
    mime === 'text/html' ||
    mime === 'text/plain' ||
    mime === 'text/csv' ||
    mime.startsWith('text/')
  )
    return 'text';
  if (mime === 'application/json' || mime === 'application/xml') return 'text';
  return 'none';
};

export function FileView({ docId, meta }: Props) {
  const mime = meta?.blob?.mime ?? 'application/octet-stream';
  const url = `/drive/blob?id=${docId}`;
  const kind = inlineable(mime);
  const label = meta?.title || 'File preview';

  if (kind === 'pdf') {
    // #toolbar=0 hides Chrome's built-in PDF toolbar (incl. Add-to-Drive).
    return (
      <div class="file-inline">
        <iframe class="file-frame" src={`${url}#toolbar=0`} title={label} />
      </div>
    );
  }
  if (kind === 'video') {
    return (
      <div class="file-inline">
        <video class="file-video" src={url} controls aria-label={label} />
      </div>
    );
  }
  if (kind === 'audio') {
    return (
      <div class="file-inline file-audio-wrap">
        <div class="file-audio-card">
          <div class="file-card-icon">🎵</div>
          <div class="file-card-title">{meta?.title}</div>
          <audio src={url} controls aria-label={label} />
        </div>
      </div>
    );
  }
  if (kind === 'text') {
    return (
      <div class="file-inline">
        <iframe class="file-frame" src={url} title={label} />
      </div>
    );
  }
  return (
    <div class="file-view">
      <div class="file-card">
        <div class="file-card-icon">📎</div>
        <div class="file-card-title">{meta?.title}</div>
        <div class="file-card-meta">
          {meta?.blob ? `${meta.blob.mime} · ${formatBytes(meta.blob.size)}` : ''}
        </div>
        <a class="btn primary pill" href={url} download>
          Download
        </a>
      </div>
    </div>
  );
}
