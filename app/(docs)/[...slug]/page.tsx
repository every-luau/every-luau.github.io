import { source } from '@/lib/source';
import { DocPage, docMetadata } from '@/lib/docs-page';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

// Every docs page, at the root like /clock or /ideology.
export const dynamicParams = false;

export default async function Page(props: PageProps<'/[...slug]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return <DocPage page={page} />;
}

export async function generateStaticParams() {
  return source.generateParams().filter((params) => params.slug.length > 0);
}

export async function generateMetadata(props: PageProps<'/[...slug]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return docMetadata(page);
}
