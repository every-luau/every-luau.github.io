import { loader, type LoaderPlugin } from 'fumadocs-core/source';
import { icons } from 'lucide-react';
import { createElement } from 'react';
import { docsContentRoute, docsImageRoute } from './shared';
import { defineDocs } from 'fumadocs-mdx/macro';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { z } from 'zod';

const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    // Library pages, written by scripts/generate.mjs, also carry their repository, the link to
    // their source, the date their source file last changed and the badges of each member, by the
    // id of its heading, for the table of contents.
    schema: pageSchema.extend({
      repository: z.string().optional(),
      source: z.string().optional(),
      lastModified: z.string().optional(),
      memberTags: z
        .record(z.string(), z.array(z.object({ label: z.string(), variant: z.string().optional() })))
        .optional(),
    }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: metaSchema,
  },
});

// The `icon` of pages and folders is a Lucide icon name, or anything else shown as text.
function iconsPlugin(): LoaderPlugin {
  const replace = <T extends { icon?: unknown }>(node: T) => {
    const icon = node.icon;
    if (typeof icon === 'string') {
      const Icon = icons[icon as keyof typeof icons];
      node.icon = Icon ? createElement(Icon) : createElement('span', { className: 'leading-none' }, icon);
    }
    return node;
  };
  return { name: 'icons', transformPageTree: { file: replace, folder: replace, separator: replace } };
}

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: '/',
  // Every page is at the root, like /clock or /ideology. The overview is /overview, since / is the
  // home page.
  url: (slugs) => `/${slugs.join('/')}`,
  source: docs.toFumadocsSource(),
  plugins: [iconsPlugin()],
});

export type DocsPageType = (typeof source)['$inferPage'];

export function getPageImageUrl(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'image.png'];

  return {
    segments,
    url: '/' + [page.locale, ...docsImageRoute.split('/'), ...segments].filter(Boolean).join('/'),
  };
}

export function getPageMarkdownUrl(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'content.md'];

  return {
    segments,
    url: '/' + [page.locale, ...docsContentRoute.split('/'), ...segments].filter(Boolean).join('/'),
  };
}

export async function getLLMText(page: (typeof source)['$inferPage']) {
  const processed = await page.data.getText('processed');

  return `# ${page.data.title} (${page.url})

${processed}`;
}
