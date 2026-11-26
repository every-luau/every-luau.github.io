import { isLibrary, source } from '@/lib/source';
import { DocPage, docMetadata } from '@/lib/docs-page';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

// A library page, at the root like /clock rather than under /docs.
export const dynamicParams = false;

export default async function Page(props: PageProps<'/[...slug]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page || !isLibrary(page.slugs)) notFound();

  return <DocPage page={page} />;
}

export async function generateStaticParams() {
  return source.generateParams().filter((params) => isLibrary(params.slug));
}

export async function generateMetadata(props: PageProps<'/[...slug]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page || !isLibrary(page.slugs)) notFound();

  return docMetadata(page);
}
