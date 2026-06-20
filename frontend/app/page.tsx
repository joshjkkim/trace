import CallsFeed from '@/components/CallsFeed';

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">trace.ai</h1>
          <p className="text-gray-400 text-sm mt-1">Live call feed — realtime from Supabase</p>
        </div>
        <CallsFeed />
      </div>
    </main>
  );
}
