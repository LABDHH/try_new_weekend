import Link from "next/link";
import { notFound } from "next/navigation";
import { ItineraryView } from "@/components/trip/Itinerary";
import { getTrip } from "@/lib/store/supabase";
import { supabaseEnabled } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Read-only share page. The uuid in the URL is the only credential. */
export default async function TripPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!supabaseEnabled()) notFound();

  const trip = await getTrip(id).catch(() => null);
  if (!trip) notFound();

  return (
    <>
      <ItineraryView itinerary={trip.itinerary} />
      <div className="mx-auto max-w-3xl px-6 pb-24">
        <Link
          href="/"
          className="rounded-full border border-sand-300 px-6 py-2.5 font-sans text-sm text-ink-700 transition hover:border-ink-500"
        >
          Plan your own
        </Link>
      </div>
    </>
  );
}
