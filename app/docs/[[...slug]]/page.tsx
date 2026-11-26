import Link from 'next/link';
import { source } from '@/lib/source';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

// The old /docs addresses, now at the root: /docs is /overview and /docs/<page> is /<page>. The
// site is a static export, so the redirect is a meta refresh rather than a status.
export const dynamicParams = false;

function target(slug: string[] | undefined): string | undefined {
  if (!slug || slug.length === 0) return '/overview';
  return source.getPage(slug)?.url;
}

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const to = target((await props.params).slug);
  if (!to) notFound();

  const href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}${to}/`;
  return (
    <>
      <meta httpEquiv="refresh" content={`0;url=${href}`} />
      <link rel="canonical" href={href} />
      <p className="p-8 text-fd-muted-foreground">
        This page moved to <Link href={to}>{to}</Link>
      </p>
    </>
  );
}

export async function generateStaticParams() {
  return [{ slug: [] }, ...source.generateParams().filter((params) => params.slug.length > 0)];
}

export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const to = target((await props.params).slug);
  if (!to) notFound();

  return { title: 'Moved', robots: { index: false } };
}
