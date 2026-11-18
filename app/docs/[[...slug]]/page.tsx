import { getPageImageUrl, getPageMarkdownUrl, source } from '@/lib/source';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  PageLastUpdate,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import { GitHubIcon, KindIcon, Member, type MemberKind } from '@/components/api';
import { Heading } from 'fumadocs-ui/components/heading';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { isValidElement, type ComponentProps, type ReactNode } from 'react';
import type { TOCItemType } from 'fumadocs-core/toc';

// The sections scripts/api.mjs writes, and what kind of member each heading under them is.
const sectionKinds: Record<string, MemberKind> = {
  Types: 'type',
  Properties: 'property',
  Constants: 'property',
  Enums: 'type',
  Events: 'event',
  Functions: 'function',
  Methods: 'method',
};

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

// The kind of each member of an API page, by the id of its heading: headings right under one of
// the sections above.
function memberKinds(toc: TOCItemType[]): Map<string, MemberKind> {
  const kinds = new Map<string, MemberKind>();
  toc.forEach((item, i) => {
    let parent: TOCItemType | undefined;
    for (let j = i - 1; j >= 0; j--) {
      if (toc[j].depth < item.depth) {
        parent = toc[j];
        break;
      }
    }
    const kind = parent && parent.depth === item.depth - 1 ? sectionKinds[textOf(parent.title)] : undefined;
    if (kind) kinds.set(item.url.slice(1), kind);
  });
  return kinds;
}

// Members are shown with the icon of their kind and their name in code, in the table of contents
// like in their heading and the summary, so the sidebar reads as an index.
function decorateToc(toc: TOCItemType[], kinds: Map<string, MemberKind>): TOCItemType[] {
  return toc.map((item) => {
    const kind = kinds.get(item.url.slice(1));
    if (!kind) return item;

    const name = textOf(item.title).replace(/^[.:]/, '');
    return {
      ...item,
      title: (
        <span className="inline-flex items-center gap-1.5">
          <KindIcon kind={kind} />
          <span className="font-mono text-[0.8125rem]">{name}</span>
        </span>
      ),
    };
  });
}

// Headings of members get the same icon, before their name in code.
function memberHeading(as: 'h3' | 'h4' | 'h5', kinds: Map<string, MemberKind>) {
  return function MemberHeading({ id, children, ...props }: ComponentProps<'h3'>) {
    const kind = id ? kinds.get(id) : undefined;
    return (
      <Heading as={as} id={id} {...props}>
        {kind ? <Member kind={kind}>{children}</Member> : children}
      </Heading>
    );
  };
}

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;
  // Library pages link to their repository and show when their source last changed instead of
  // the previous/next page.
  const { repository, lastModified } = page.data;
  const kinds = repository ? memberKinds(page.data.toc) : new Map<string, MemberKind>();

  return (
    <DocsPage toc={decorateToc(page.data.toc, kinds)} full={page.data.full} footer={{ enabled: !repository }}>
      <DocsTitle>
        {repository && page.data.icon && <span className="me-2">{page.data.icon}</span>}
        {page.data.title}
      </DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover markdownUrl={markdownUrl} />
        {repository && (
          <a
            href={repository}
            className={buttonVariants({
              color: 'secondary',
              size: 'sm',
              className: 'gap-2 [&_svg]:size-3.5 [&_svg]:text-fd-muted-foreground',
            })}
          >
            <GitHubIcon />
            View on GitHub
          </a>
        )}
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
            h3: memberHeading('h3', kinds),
            h4: memberHeading('h4', kinds),
            h5: memberHeading('h5', kinds),
          })}
        />
      </DocsBody>
      {lastModified && <PageLastUpdate date={new Date(lastModified)} />}
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImageUrl(page).url,
    },
  };
}
