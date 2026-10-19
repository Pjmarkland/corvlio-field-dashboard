import { Link, Redirect } from 'wouter';
import { useGetBusinessProfile, getGetBusinessProfileQueryKey } from '@workspace/api-client-react';
import NativeBillingSection from '@/components/NativeBillingSection';
export default function NativeBillingPage() {
  const profile=useGetBusinessProfile({query:{queryKey:getGetBusinessProfileQueryKey(),retry:false}});
  if(profile.data?.isInternal)return <Redirect to="/dashboard" />;
  return <main className="mx-auto min-h-screen max-w-xl bg-background px-4 py-8 text-foreground">
    <Link href="/settings" className="inline-flex min-h-11 items-center font-semibold underline">Back to Settings</Link>
    <NativeBillingSection />
  </main>;
}
