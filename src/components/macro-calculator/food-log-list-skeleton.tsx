export function FoodLogListSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((index) => (
        <div key={index} className="rounded-2xl bg-card/60 p-5">
          <div className="h-5 w-1/3 animate-shimmer rounded-lg" />
          <div className="mt-3 h-3 w-2/3 animate-shimmer rounded-lg" />
          <div className="mt-2 h-3 w-1/2 animate-shimmer rounded-lg" />
          <div className="mt-4 grid grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((bar) => (
              <div key={bar} className="h-8 animate-shimmer rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
