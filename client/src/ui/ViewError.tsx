// Shared error state for list views: shown when a listing fetch fails, so
// "the network broke" is distinguishable from "you have nothing here".
type Props = { onRetry: () => void; message?: string };

export function ViewError({ onRetry, message }: Props) {
  return (
    <div class="view-error" role="alert">
      <p>{message ?? "Couldn't load this view. Your ship may be unreachable."}</p>
      <button class="btn" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
