import { useEffect } from 'react';
import { ArrowLeft, ArrowUpRight, Mail } from 'lucide-react';
import { Link } from 'wouter';
import logoUrl from '@/assets/logo-dark.png';

export default function SupportPage() {
  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;
    document.title = 'Support | Corvlio Field Dashboard';
    if (description) {
      description.content = 'Contact Corvlio support for help with your account or Field Dashboard.';
    }
    return () => {
      document.title = previousTitle;
      if (description && previousDescription !== undefined) description.content = previousDescription;
    };
  }, []);

  return (
    <main className="min-h-[100dvh] bg-background px-5 py-8 text-foreground sm:px-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <Link href="/" data-testid="link-support-home" className="mb-10 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft size={16} /> Back to Corvlio
        </Link>
        <header className="border-b border-border pb-8">
          <div className="mb-5 flex items-center"><img src={logoUrl} alt="Corvlio" className="h-auto w-[174px]" /></div>
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Support</p>
          <h1 className="text-4xl font-800 leading-none tracking-[-0.055em] sm:text-5xl">How can we help?</h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
            For help with your Corvlio account or Field Dashboard, email our support team.
          </p>
          <a
            href="mailto:hello@corvlio.com?subject=Corvlio%20support"
            data-testid="link-support-email"
            className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary-hover"
          >
            <Mail size={17} /> Email hello@corvlio.com <ArrowUpRight size={15} />
          </a>
          <p className="mt-4 text-sm text-muted-foreground">We aim to respond within two business days.</p>
        </header>

        <section className="py-8">
          <h2 className="text-xl font-800 tracking-[-0.025em]">What to include</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-[15px] leading-7 text-muted-foreground">
            <li>Your account email and business name.</li>
            <li>Your device model, iOS version, and app version.</li>
            <li>What happened and the steps to reproduce it. Include a screenshot if it helps explain the issue.</li>
          </ul>
          <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
            Please do not email your password, payment-card details, or sensitive caller information.
          </p>
        </section>
      </div>
    </main>
  );
}
