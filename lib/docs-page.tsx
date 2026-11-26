import { getPageImageUrl, getPageMarkdownUrl, source, type DocsPageType } from '@/lib/source';
import {
  DocsBody,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  PageLastUpdate,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import { GitHubIcon, KindIcon, Member, Tag, type MemberKind } from '@/components/api';
import { Heading } from 'fumadocs-ui/components/heading';
import { getMDXComponents } from '@/components/mdx';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { isValidElement, type ComponentProps, type ReactNode } from 'react';
import type { TOCItemType } from 'fumadocs-core/toc';

// A docs page, served at the root by app/(docs)/[...slug]/page.tsx.
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

type MemberTags = Record<string, { label: string; variant?: string }[]>;

// Members are shown with the icon of their kind, their name in code and their badges, like Server
// or Yields, in the table of contents like in their heading, so the sidebar reads as an index.
function decorateToc(toc: TOCItemType[], kinds: Map<string, MemberKind>, tags: MemberTags = {}): TOCItemType[] {
  return toc.map((item) => {
    const id = item.url.slice(1);
    const kind = kinds.get(id);
    if (!kind) return item;

    const name = textOf(item.title).replace(/^[.:]/, '');
    return {
      ...item,
      title: (
        <span key={item.url} className="inline-flex flex-wrap items-center gap-1.5">
          <KindIcon kind={kind} />
          <span className="font-mono text-[0.8125rem]">{name}</span>
          {tags[id]?.map((tag) => (
            <Tag key={tag.label} label={tag.label} variant={tag.variant} compact />
          ))}
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

export async function DocPage({ page }: { page: DocsPageType }) {
  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;
  // Library pages link to their repository and show when their source last changed instead of
  // the previous/next page.
  const { repository, lastModified } = page.data;
  const kinds = repository ? memberKinds(page.data.toc) : new Map<string, MemberKind>();

  return (
    <DocsPage
      toc={decorateToc(page.data.toc, kinds, page.data.memberTags)}
      full={page.data.full}
      footer={{ enabled: !repository }}
    >
      {/* The title, with a link to its source on the right when there is one, then the buttons. */}
      <div className="flex flex-row items-center gap-2">
        <DocsTitle>{page.data.title}</DocsTitle>
        {page.data.source && (
          <a
            href={page.data.source}
            title="View source"
            className="ms-auto rounded-md px-1.5 py-0.5 font-mono text-xs text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground"
          >
            {'</>'}
          </a>
        )}
      </div>
      <div className="flex flex-row flex-wrap items-center gap-2 border-b pb-6">
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
        {/* The description reads like the text under it. */}
        {page.data.description && <p>{page.data.description}</p>}
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

export function docMetadata(page: DocsPageType): Metadata {
  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImageUrl(page).url,
    },
  };
}
