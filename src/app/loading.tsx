export default function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div
        role="status"
        aria-label="로딩 중"
        className="border-muted border-t-primary size-8 animate-spin rounded-full border-2"
      />
    </div>
  );
}
