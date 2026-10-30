import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { Link } from 'wouter';
import logoUrl from '@/assets/logo-dark.png';

function ClientAgreementPage() {
  const native = Capacitor.isNativePlatform();
  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;
    document.title = 'Client Service Agreement | Corvlio Field Dashboard';
    if (description) {
      description.content = 'Client Service Agreement for Corvlio, an AI-powered call-intake service operated by Markland Ventures LLC.';
    }
    return () => {
      document.title = previousTitle;
      if (description && previousDescription) description.content = previousDescription;
    };
  }, []);

  return (
    <main className="min-h-[100dvh] bg-background px-5 py-8 text-foreground sm:px-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <Link href="/" data-testid="link-client-agreement-home" className="mb-10 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /> Back to Corvlio</Link>
        <header className="border-b border-border pb-8">
          <div className="mb-5 flex items-center"><img src={logoUrl} alt="Corvlio" className="h-auto w-[174px]" /></div>
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Client service agreement</p>
          <h1 className="text-4xl font-800 leading-none tracking-[-0.055em] sm:text-5xl">A clear agreement for a better first call.</h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">CORVLIO CLIENT SERVICE AGREEMENT — Markland Ventures LLC d/b/a Corvlio. Entered into between Markland Ventures LLC, a Florida LLC d/b/a Corvlio (&quot;Company&quot;), and the Client identified at signup.</p>
        </header>

        <div className="space-y-8 py-8 text-[15px] leading-7 text-muted-foreground">
          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">1. Services</h2>
            <p>Company provides an AI-powered voice receptionist that answers inbound calls, discloses it&apos;s an AI assistant and that the call is recorded, and captures the caller&apos;s issue, name, address, urgency, availability, and phone number (&quot;Intake Information&quot;), delivered by email and dashboard. The Service does not book appointments or quote pricing — Client handles all callbacks. Setup typically completes within three to five business days, followed by a go-live call.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">2. Client Responsibilities</h2>
            <p>Client must have authority to enter this Agreement and the legal right to route the phone number(s) used. Client will provide accurate business information and promptly update it; maintain call forwarding to the Corvlio number; not disable the AI-disclosure or recording notice required by Fla. Stat. § 934.03; review and follow up on Intakes promptly; use the Service only lawfully; and keep dashboard credentials confidential.</p>
          </section>

          {!native && <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">3. Fees and Payment</h2>
            <p>Client subscribes to a published plan (Startup, Starter, Professional, Managed), billed monthly in advance. The setup fee is due at signing and non-refundable once configuration begins; monthly fees are non-refundable and not prorated. Call volume over the plan allotment moves Client to the next tier, no per-call overage charge. A failed payment gives Client five business days to cure before suspension; overdue amounts accrue a 1.5% monthly late fee (or the legal maximum if lower).</p>
          </section>}

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">4. Term and Termination</h2>
            <p>Month-to-month, ending with thirty days&apos; written notice from either Party. Company may suspend or terminate immediately for material breach, including using the Service unlawfully, to harass or defraud callers, in violation of this Agreement, or in a way Company reasonably believes creates legal or reputational risk. On termination, Client gets at least fifteen days to export Intake Information before Company deletes it within thirty days after, except where legal retention applies. Call recordings are kept thirty days post-termination and provided only on written request{native ? '.' : ' for a $100 fee.'}</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">5. Warranty Disclaimer</h2>
            <p>THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE,&quot; ALL WARRANTIES DISCLAIMED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">6. AI Disclosure; No Guarantee of Results</h2>
            <p>The Service is powered by a probabilistic large language model. Company isn&apos;t liable for a misquoted detail or intake error absent gross negligence or willful misconduct, and doesn&apos;t guarantee any specific number of calls, leads, or resulting revenue.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">7. Third-Party Services</h2>
            <p>The Service relies on third-party platforms including Retell AI, Twilio, Google, and Replit. Company isn&apos;t responsible for interruptions caused by a third-party platform outside its reasonable control.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">8. Data and Privacy</h2>
            <p>Client is responsible for the accuracy of information it provides and its own compliant use of Intake Information. Client won&apos;t direct callers to provide, and the Service isn&apos;t designed to collect, payment card numbers, government IDs, or protected health information. See the Privacy Policy for how caller information is handled.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">9. Limitation of Liability</h2>
            <p>Except for indemnification, confidentiality breaches, or gross negligence/willful misconduct, NEITHER PARTY IS LIABLE FOR INDIRECT, INCIDENTAL, OR CONSEQUENTIAL DAMAGES. Company&apos;s total liability won&apos;t exceed fees paid by Client in the three months preceding the claim.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">10. Indemnification</h2>
            <p>Client indemnifies Company for claims from Client&apos;s misuse, legal violations, or inaccurate information. Company indemnifies Client for claims that the Service, used as intended, infringes a third party&apos;s IP.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">11. Confidentiality</h2>
            <p>Each Party keeps the other&apos;s non-public business, technical, or pricing information confidential, used only to perform this Agreement.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">12. Ownership</h2>
            <p>Company owns the Service, its software, configurations, prompts, and workflows. Client owns its own business data and Intake Information, and won&apos;t reverse-engineer the Service or use it to build a competing product.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">13. Marketing References</h2>
            <p>Company may identify Client by name and logo as a customer in its marketing unless Client opts out in writing.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">14. Independent Contractor; Non-Exclusivity</h2>
            <p>Company is an independent contractor; this Agreement creates no partnership or employment relationship. Company may serve other businesses, including Client&apos;s competitors.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">15. Insurance</h2>
            <p>Company maintains commercially reasonable tech E&amp;O and cyber liability insurance, with proof available on reasonable request.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">16. Force Majeure</h2>
            <p>Neither Party is liable for delay from events beyond its reasonable control, including third-party platform failures under Section 7.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">17. Assignment</h2>
            <p>Client can&apos;t assign this Agreement without Company&apos;s consent; Company may assign it in a merger, acquisition, or sale of substantially all its assets.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">18. Governing Law and Venue</h2>
            <p>Governed by Florida law; Lee County, Florida is the proper venue.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">19. Dispute Resolution</h2>
            <p>Any dispute will be brought exclusively in the state or federal courts of Lee County, Florida, and each Party consents to those courts&apos; jurisdiction. EACH PARTY WAIVES ITS RIGHT TO A TRIAL BY JURY. The prevailing party in an enforcement action recovers reasonable attorney&apos;s fees and costs. Either Party may still bring an individual claim in small claims court where it qualifies.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">20. Survival</h2>
            <p>Sections 9, 10, 11, 12, 18, 19, and this Section 20 survive termination, along with accrued payment obligations.</p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-800 tracking-[-0.025em] text-foreground">21. General</h2>
            <p>This Agreement, the Terms of Service, and the Privacy Policy are the entire agreement between the Parties. Amendments require a signed writing, except Company may update its Terms of Service or Privacy Policy with reasonable notice. A Party&apos;s failure to enforce a provision isn&apos;t a waiver. If a provision is unenforceable, the rest remains in force. This Agreement may be signed electronically.</p>
          </section>

          <section className="rounded-2xl bg-sidebar p-5 text-sidebar-foreground sm:p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Agreement questions</p>
            <h2 className="mt-2 text-xl font-800">Contact Corvlio</h2>
            <p className="mt-2 text-sm leading-relaxed text-sidebar-foreground/65">Questions about this Client Service Agreement?</p>
            <a href="mailto:pj@corvlio.com" data-testid="link-client-agreement-email" className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground">pj@corvlio.com <ArrowUpRight size={16} /></a>
          </section>
        </div>
      </div>
    </main>
  );
}

export default ClientAgreementPage;