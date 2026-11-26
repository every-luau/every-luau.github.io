import Link from 'next/link';
import { isLibrary, source } from '@/lib/source';
import { DocPage, docMetadata } from '@/lib/docs-page';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

// Every page but the libraries, which are served at the root: their old /docs/<library> address
// sends to it. The site is a static export, so the redirect is a meta refresh rather than a status.
export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();
  if (isLibrary(page.slugs)) return <Moved to={page.url} />;

  return <DocPage page={page} />;
}

function Moved({ to }: { to: string }) {
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
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();
  if (isLibrary(page.slugs)) return { title: page.data.title, robots: { index: false } };

  return docMetadata(page);
}
