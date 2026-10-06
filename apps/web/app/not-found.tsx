export default function NotFound() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        That ticket is not in Handover. <a href="/history" className="text-blue-600 hover:underline dark:text-blue-400">Back to Task History</a>
      </p>
    </div>
  );
}
