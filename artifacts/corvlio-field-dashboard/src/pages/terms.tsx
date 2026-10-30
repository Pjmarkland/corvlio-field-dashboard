import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { Link } from 'wouter';
import logoUrl from '@/assets/logo-dark.png';

function TermsPage() {
  const native = Capacitor.isNativePlatform();
  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;
    document.title = 'Terms of Service | Corvlio Field Dashboard';
    if (description) {
      description.content = 'Terms governing access to and use of Corvlio, an AI-powered call-intake service operated by Markland Ventures LLC.';
    }
    return () => {
      document.title = previousTitle;
      if (description && previousDescription) description.content = previousDescription;
    };
  }, []);

  return (
    <main className="min-h-[100dvh] bg-background px-5 py-8 text-foreground sm:px-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <Link href="/" data-testid="link-terms-home" className="mb-10 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /> Back to Corvlio</Link>
        <header className="border-b border-border pb-8">
          <div className="mb-5 flex items-center"><img src={logoUrl} alt="Corvlio" className="h-auto w-[174px]" /></div>
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Terms of service</p>
          <h1 className="text-4xl font-800 leading-none tracking-[-0.055em] sm:text-5xl">Terms for a clear, accountable service.</h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">These Terms of Service (&quot;Terms&quot;) govern access to and use of Corvlio, an AI-powered call-intake service operated by Markland Ventures LLC, a Florida limited liability company (&quot;Corvlio,&quot; &quot;we,&quot; &quot;us&quot;). By signing a service agreement with Corvlio, forwarding calls to a Corvlio number, or otherwise using the Service, you (&quot;Client&quot;) agree to these Terms.</p>
        </header>

        <div className="space-y-8 py-8 text-[15px] leading-7 text-muted-foreground">
          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">1. THE SERVICE</h2>
            <p><strong className="text-foreground">1.1 Description:</strong> Corvlio answers incoming calls forwarded by the Client using an AI voice agent. The agent identifies itself as AI, discloses that the call is recorded, and captures the caller&apos;s issue, name, address, urgency, availability, and phone number (the &quot;Intake&quot;). The agent does not book appointments or quote prices; the Client is responsible for calling the lead back.</p>
            <p className="mt-3"><strong className="text-foreground">1.2 Delivery:</strong> Each Intake is recorded to the Client&apos;s dashboard, and a summary is emailed to the Client.</p>
            <p className="mt-3"><strong className="text-foreground">1.3 No Guarantee of Outcome:</strong> Corvlio does not guarantee any call will result in a booked job, sale, or particular business outcome.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">2. CLIENT RESPONSIBILITIES</h2>
            <p><strong className="text-foreground">2.1 Call Forwarding:</strong> Client is responsible for setting up and maintaining call forwarding to the Corvlio number.</p>
            <p className="mt-3"><strong className="text-foreground">2.2 Accurate Information:</strong> Client shall provide accurate business information and promptly notify Corvlio of changes.</p>
            <p className="mt-3"><strong className="text-foreground">2.3 Callbacks:</strong> Client is solely responsible for following up on Intakes.</p>
          </section>

          {!native && <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">3. FEES AND PAYMENT</h2>
            <p><strong className="text-foreground">3.1 Pricing:</strong> fees per Corvlio&apos;s published tiers (Startup, Starter, Professional, Managed).</p>
            <p className="mt-3"><strong className="text-foreground">3.2 Setup Fee:</strong> non-refundable once build work begins.</p>
            <p className="mt-3"><strong className="text-foreground">3.3 Billing:</strong> monthly in advance; call volume over the plan allotment moves Client to the next tier, no per-call overage charge.</p>
            <p className="mt-3"><strong className="text-foreground">3.4 Late Payment:</strong> Corvlio may suspend the Service if payment isn&apos;t received within a reasonable period after notice.</p>
          </section>}

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">4. TERM AND TERMINATION</h2>
            <p><strong className="text-foreground">4.1</strong> Month-to-month from go-live date.</p>
            <p className="mt-3"><strong className="text-foreground">4.2</strong> Either party may cancel with thirty (30) days&apos; written notice{native ? '.' : '; Client owes fees through the notice period.'}</p>
            <p className="mt-3"><strong className="text-foreground">4.3</strong> Upon termination Corvlio stops routing calls and will export Client&apos;s Intake records on request.</p>
            <p className="mt-3"><strong className="text-foreground">4.4 Suspension for Misuse:</strong> Corvlio may suspend or terminate immediately, upon notice, if Client uses the Service unlawfully, to harass or defraud callers, in violation of these Terms, or in a way Corvlio reasonably believes creates legal or reputational risk.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">5. AI DISCLOSURE AND CALL RECORDING</h2>
            <p>Every call begins with a disclosure that the caller is speaking with an AI assistant and the call is recorded, per Florida&apos;s all-party consent law (Fla. Stat. § 934.03). By using the Service, Client consents to this on behalf of itself and its callers.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">6. DATA OWNERSHIP</h2>
            <p>Client owns its Intake data; Corvlio processes it solely to deliver the Service, per the Privacy Policy. Corvlio retains all rights to its underlying software, workflows, scripts, and prompts.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">7. WARRANTIES AND LIABILITY</h2>
            <p><strong className="text-foreground">7.1</strong> THE SERVICE IS PROVIDED &quot;AS IS,&quot; ALL WARRANTIES DISCLAIMED TO THE FULLEST EXTENT PERMITTED BY LAW.</p>
            <p className="mt-3"><strong className="text-foreground">7.2</strong> Corvlio&apos;s total liability will not exceed fees paid by Client in the three (3) months preceding the claim; Corvlio is not liable for lost profits or consequential damages.</p>
            <p className="mt-3"><strong className="text-foreground">7.3</strong> Client indemnifies Corvlio for claims from Client&apos;s inaccurate information, failure to follow up, or violation of these Terms.</p>
            <p className="mt-3"><strong className="text-foreground">7.4</strong> Corvlio relies on third-party telephony, voice-AI, automation, and hosting providers, and is not liable for their outages or failures beyond Corvlio&apos;s reasonable control.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">8. DISPUTE RESOLUTION</h2>
            <p><strong className="text-foreground">8.1</strong> Governed by Florida law.</p>
            <p className="mt-3"><strong className="text-foreground">8.2 Exclusive venue:</strong> state or federal courts in Lee County, Florida.</p>
            <p className="mt-3"><strong className="text-foreground">8.3</strong> EACH PARTY WAIVES ITS RIGHT TO A TRIAL BY JURY.</p>
            <p className="mt-3"><strong className="text-foreground">8.4</strong> Either party may bring an individual claim in small claims court where it qualifies.</p>
            <p className="mt-3"><strong className="text-foreground">8.5</strong> The prevailing party in an enforcement action recovers reasonable attorney&apos;s fees and costs.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">9. GENERAL</h2>
            <p>Client may not assign these Terms without consent; Corvlio may assign in a merger or sale of substantially all its business. Neither party is liable for delay from force majeure events, including third-party provider failures. These Terms plus the Client&apos;s signed service agreement are the entire agreement. If a provision is invalid, the rest remains in force. Corvlio may update these Terms with notice; continued use constitutes acceptance.</p>
          </section>

          <section className="rounded-2xl bg-sidebar p-5 text-sidebar-foreground sm:p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Terms questions</p>
            <h2 className="mt-2 text-xl font-800">Contact Corvlio</h2>
            <p className="mt-2 text-sm leading-relaxed text-sidebar-foreground/65">Questions about these Terms?</p>
            <a href="mailto:pj@corvlio.com" data-testid="link-terms-email" className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground">pj@corvlio.com <ArrowUpRight size={16} /></a>
          </section>
        </div>
      </div>
    </main>
  );
}

export default TermsPage;