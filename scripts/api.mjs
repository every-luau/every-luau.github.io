// Writes Moonwave-style API pages from fumablox's extract (see `fumablox extract`), one per source
// file and laid out like the source tree, rendered with the components in components/api.tsx.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Not exported by the package, so imported by path, like the CLI in generate.mjs.
const { resolveLink, rewriteShortLinks } = await import(
  pathToFileURL(path.resolve(import.meta.dirname, '../node_modules/@metricsrb/fumablox/dist/extract/links.js')).href
);

const admonitions = {
  tip: ['success', 'Tip'],
  note: ['info', 'Note'],
  info: ['info', 'Info'],
  caution: ['warn', 'Caution'],
  warning: ['warn', 'Warning'],
  danger: ['error', 'Danger'],
};

const attr = (value) => `{${JSON.stringify(value)}}`;

// fumablox only resolves `[Class:member]` for the library's own classes; this links members of
// the other libraries, like [Signal:connect], to their heading on that library's page.
function siblingMemberLinks(text, ctx) {
  return text.replace(/\[([A-Za-z_]\w*)[.:]([A-Za-z_]\w*)\](?!\()/g, (match, name, member) => {
    const page = ctx.siblings?.[name];
    return page ? `${match}(${page}#${member})` : match;
  });
}

// Escapes what MDX would parse as JSX outside of code, and turns Moonwave's
// `:::tip Title` ... `:::` admonitions into callouts.
function markdown(text, ctx) {
  if (!text) return '';
  const escaped = rewriteShortLinks(siblingMemberLinks(text, ctx), ctx)
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/[{}<]/g, (c) => `\\${c}`)))
    .join('');

  return escaped
    .split('\n')
    .map((line) => {
      const open = line.match(/^:::\s*(\w+)\s*(.*)$/);
      if (open && admonitions[open[1].toLowerCase()]) {
        const [type, title] = admonitions[open[1].toLowerCase()];
        return `<Callout type="${type}" title=${attr(open[2].trim() || title)}>\n`;
      }
      return line.trim() === ':::' ? '\n</Callout>' : line;
    })
    .join('\n');
}

// First paragraph as plain text, for the page description.
function summary(text) {
  const first = (text ?? '').split(/\n\s*\n/)[0] ?? '';
  if (first.startsWith('```') || first.startsWith(':::')) return '';
  return first
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function rest(text) {
  const paragraphs = (text ?? '').split(/\n\s*\n/);
  return summary(text) ? paragraphs.slice(1).join('\n\n') : text ?? '';
}

// A Roblox enum like `Enum.PreferredInput` links as a whole to its own page, instead of `Enum`
// linking to the Enum datatype.
const ROBLOX_ENUM = /\bEnum\.([A-Za-z_]\w*)/g;

function linksFor(ctx, ...types) {
  const links = {};
  for (const type of types) {
    if (ctx.robloxLinks) {
      for (const [whole, name] of (type ?? '').matchAll(ROBLOX_ENUM)) {
        links[whole] = `https://create.roblox.com/docs/reference/engine/enums/${name}`;
      }
    }
    const rest = ctx.robloxLinks ? (type ?? '').replace(ROBLOX_ENUM, '') : type ?? '';
    for (const [ident] of rest.matchAll(/[A-Za-z_][\w]*/g)) {
      const href = resolveLink(ident, ctx);
      if (href) links[ident] = href;
    }
  }
  return links;
}

function badges(meta, extra = []) {
  const items = [...extra];
  for (const realm of meta.realms ?? []) {
    items.push({ label: realm[0].toUpperCase() + realm.slice(1), variant: realm });
  }
  if (meta.deprecated) items.push({ label: 'Deprecated', variant: 'deprecated' });
  if (meta.unreleased) items.push({ label: 'Unreleased', variant: 'unreleased' });
  if (meta.since) items.push({ label: `since ${meta.since}` });
  for (const tag of meta.tags ?? []) items.push({ label: tag });
  return items;
}

// The badges of each member of the page being written, by the id of its heading, for the table
// of contents (see `memberTags` in filePage). `heading` is the member whose badges come next.
let pageTags = null;
let heading = null;

function badgeLine(meta, config, extra) {
  const items = badges(meta, extra);
  if (pageTags && heading) {
    if (items.length > 0) pageTags[heading] = items;
    heading = null;
  }
  const source = sourceUrl(meta.source, config);
  if (items.length === 0 && !source) return [];
  return [`<Badges items=${attr(items)}${source ? ` source=${attr(source)}` : ''} />`, ''];
}

function sourceUrl(source, config) {
  if (!source || !config.gitRepoUrl) return undefined;
  const repo = config.gitRepoUrl.replace(/\.git$/, '').replace(/\/$/, '');
  // sourcePrefix is the library's folder in its repo, like `libraries/Signal/` in the monorepo.
  const file = `${config.sourcePrefix ?? ''}${source.path.replaceAll('\\', '/')}`;
  return `${repo}/blob/${config.gitSourceBranch ?? 'main'}/${file}#L${source.line}`;
}

function deprecation(meta, ctx) {
  if (!meta.deprecated) return [];
  return [
    `<Callout type="warn" title=${attr(`Deprecated in ${meta.deprecated.version}`)}>`,
    '',
    markdown(meta.deprecated.description, ctx) || 'This is deprecated.',
    '',
    '</Callout>',
    '',
  ];
}

const cell = (text, ctx) => markdown(text, ctx).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

// An attribute inside a table cell: a `|` would end the cell in the middle of the expression,
// so it is written as a JavaScript escape that still reads as `|` once evaluated.
const cellAttr = (value) => attr(value).replace(/\|/g, '\\u007c');

function table(title, rows, ctx) {
  if (rows.length === 0) return [];
  const withNames = rows.some((row) => row.name !== undefined);
  const header = withNames ? '| Name | Type | Description |\n| --- | --- | --- |' : '| Type | Description |\n| --- | --- |';
  return [
    `**${title}**`,
    '',
    header,
    ...rows.map((row) => {
      const type = row.type ? `<TypeCode type=${cellAttr(row.type)} links=${cellAttr(linksFor(ctx, row.type))} />` : '';
      const cells = [type, cell(row.description, ctx) || '—'];
      if (withNames) cells.unshift(`\`${row.name}${row.optional ? '?' : ''}\``);
      return `| ${cells.join(' | ')} |`;
    }),
    '',
  ];
}

const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
const visible = (member) => !member.private && !member.ignore;

// Heading levels and anchor ids: a page with several classes nests each one a level deeper
// and prefixes its anchors with the class name.
// A method named like another member of its class, like `Stream.property` and `:property`, gets
// `-method` after its anchor so both headings keep their own.
function layout(cls, nested) {
  const id = (name) => (nested ? `${cls.name}-${name}` : name);
  const taken = new Set(
    [...cls.types, ...cls.properties, ...cls.events, ...cls.constants, ...cls.enums, ...cls.functions]
      .filter((member) => visible(member) && member.functionKind !== 'method')
      .map((member) => member.name),
  );
  return {
    section: nested ? '###' : '##',
    member: nested ? '####' : '###',
    id,
    fnId: (fn) => id(fn.functionKind === 'method' && taken.has(fn.name) ? `${fn.name}-method` : fn.name),
  };
}

// A member's heading stays plain text: the docs page adds the icon of its kind (see
// app/docs/[[...slug]]/page.tsx), since headings also become the table of contents.
function memberHeading(h, label, name, id = h.id(name)) {
  heading = id;
  return `${h.member} ${label} [#${id}]`;
}

function typeSection(cls, ctx, config, h) {
  const types = cls.types.filter(visible).sort(byName);
  if (types.length === 0) return [];
  return [
    `${h.section} Types`,
    '',
    ...types.flatMap((type) => [
      memberHeading(h, type.name, type.name),
      '',
      ...badgeLine(type, config),
      ...deprecation(type, ctx),
      ...(type.luaType
        ? [`<Signature kind="type" name=${attr(type.name)} type=${attr(type.luaType)} links=${attr(linksFor(ctx, type.luaType))} />`, '']
        : []),
      markdown(type.description, ctx),
      '',
      ...table(
        'Fields',
        type.fields.map((field) => ({ name: field.name, type: field.luaType, description: field.description })),
        ctx,
      ),
    ]),
  ];
}

function valueSection(title, members, cls, ctx, config, h) {
  const list = members.filter(visible).sort(byName);
  if (list.length === 0) return [];
  return [
    `${h.section} ${title}`,
    '',
    ...list.flatMap((member) => [
      memberHeading(h, member.name, member.name),
      '',
      ...badgeLine(member, config, member.readonly ? [{ label: 'Read only' }] : []),
      ...deprecation(member, ctx),
      `<Signature kind="value" owner=${attr(cls.name)} name=${attr(member.name)} type=${attr(member.luaType ?? member.value ?? 'any')} links=${attr(linksFor(ctx, member.luaType))} />`,
      '',
      markdown(member.description, ctx),
      '',
    ]),
  ];
}

function enumSection(cls, ctx, config, h) {
  const enums = cls.enums.filter(visible).sort(byName);
  if (enums.length === 0) return [];
  return [
    `${h.section} Enums`,
    '',
    ...enums.flatMap((item) => [
      memberHeading(h, item.name, item.name),
      '',
      ...badgeLine(item, config),
      markdown(item.description, ctx),
      '',
      '| Item | Value | Description |',
      '| --- | --- | --- |',
      ...item.items.map((entry) => `| \`${entry.name}\` | \`${entry.value}\` | ${cell(entry.description, ctx)} |`),
      '',
    ]),
  ];
}

// Everything below a function's heading: badges, signature, the description's first paragraph,
// its parameters, return values and errors, then the rest of the description and examples. `callee` is how it is called: `Class.name`, `Class:name`,
// or just `Class` when requiring the module returns the function itself.
function functionBody(fn, callee, ctx, config) {
  const types = [...fn.params.map((p) => p.luaType), ...fn.returns.map((r) => r.luaType)];
  const extra = fn.yields ? [{ label: 'Yields', variant: 'yields' }] : [];

  return [
    ...badgeLine(fn, config, extra),
    ...deprecation(fn, ctx),
    `<Signature${callee.owner ? ` owner=${attr(callee.owner)} separator="${callee.separator}"` : ''} name=${attr(callee.name)} params=${attr(
      fn.params.map((p) => ({ name: p.optional ? `${p.name}?` : p.name, type: p.luaType })),
    )} returns=${attr(fn.returns.map((r) => r.luaType))} links=${attr(linksFor(ctx, ...types))} />`,
    '',
    summary(fn.description) ? markdown(fn.description.split(/\n\s*\n/)[0], ctx) : '',
    '',
    ...table(
      'Parameters',
      fn.params.map((p) => ({ name: p.name, type: p.luaType ?? 'any', description: p.description, optional: p.optional })),
      ctx,
    ),
    ...table('Return values', fn.returns.map((r) => ({ type: r.luaType, description: r.description })), ctx),
    ...table('Errors', fn.errors.map((e) => ({ type: e.luaType, description: e.description })), ctx),
    markdown(rest(fn.description), ctx),
    '',
    ...fn.examples.flatMap((example) => [
      `\`\`\`${example.language || 'lua'}${example.title ? ` title=${JSON.stringify(example.title)}` : ''}`,
      example.code,
      '```',
      '',
    ]),
  ];
}

// The function `require` gives back, for a module that returns a function instead of a table.
// It may be documented as a @function or as a @type; for a type, the parameters and return
// values come from the function in the source.
function returnsSection(items, cls, ctx, config, h) {
  if (items.length === 0) return [];
  return [
    `${h.section} Returns [#${h.id('returns')}]`,
    '',
    `Requiring this module returns a function: call \`${cls.name}(...)\` directly.`,
    '',
    ...items.flatMap((item) => {
      const signature = ctx.returned.get(item);
      const fn = item.kind === 'function' ? item : { ...item, yields: false, errors: [], examples: [], ...signature };
      return functionBody(fn, { name: cls.name }, ctx, config);
    }),
  ];
}

function functionSection(title, fns, cls, ctx, config, h) {
  if (fns.length === 0) return [];
  return [
    `${h.section} ${title}`,
    '',
    ...fns.sort(byName).flatMap((fn) => {
      const separator = fn.functionKind === 'method' ? ':' : '.';
      return [
        memberHeading(h, `${separator}${fn.name}`, fn.name, h.fnId(fn)),
        '',
        ...functionBody(fn, { owner: cls.name, separator, name: fn.name }, ctx, config),
      ];
    }),
  ];
}

// Every member on one line each, grouped like the sections below and linking to them, so a class
// can be read at a glance before its details.
function summarySection(cls, others, ctx, h) {
  const summaryBadges = (member) => [
    ...(member.yields ? [{ label: 'Yields', variant: 'yields' }] : []),
    ...(member.deprecated ? [{ label: 'Deprecated', variant: 'deprecated' }] : []),
  ];
  const value = (kind) => (member) => ({
    kind,
    name: member.name,
    href: `#${h.id(member.name)}`,
    type: member.luaType ?? member.value ?? 'any',
    badges: summaryBadges(member),
  });
  const fn = (kind) => (member) => ({
    kind,
    name: member.name,
    href: ctx.split.get(member)?.url ?? `#${h.fnId(member)}`,
    params: member.params.map((p) => ({ name: p.optional ? `${p.name}?` : p.name, type: p.luaType })),
    returns: member.returns.map((r) => r.luaType ?? 'any'),
    badges: summaryBadges(member),
  });

  const type = (member) => ({ kind: 'type', name: member.name, href: `#${h.id(member.name)}`, badges: summaryBadges(member) });
  const sorted = (members) => members.filter(visible).sort(byName);

  const groups = [
    ['Types', sorted(cls.types).map(type)],
    ['Properties', sorted([...cls.properties, ...cls.constants]).map(value('property'))],
    ['Events', sorted(cls.events).map(value('event'))],
    ['Functions', sorted(others.filter((f) => f.functionKind !== 'method')).map(fn('function'))],
    ['Methods', sorted(others.filter((f) => f.functionKind === 'method')).map(fn('method'))],
  ].filter(([, items]) => items.length > 0);
  if (groups.length === 0) return [];

  const types = groups.flatMap(([, items]) => items.flatMap((item) => [item.type, ...(item.params ?? []).map((p) => p.type), ...(item.returns ?? [])]));
  const links = linksFor(ctx, ...types);

  return [
    `${h.section} Summary [#${h.id('summary')}]`,
    '',
    ...groups.flatMap(([title, items]) => [
      `${h.member} ${title} [#${h.id(`summary-${title.toLowerCase()}`)}]`,
      '',
      `<Summary items=${attr(items)} links=${attr(links)} />`,
      '',
    ]),
  ];
}

function classBody(cls, ctx, config, nested, after = []) {
  const h = layout(cls, nested);
  // The source of a single class is linked next to the page's buttons, see `source` in filePage.
  const classBadges = badges(cls);
  const intro = nested
    ? [`## ${cls.name} [#${cls.name}]`, '', ...badgeLine(cls, config), markdown(cls.description, ctx)]
    : [
        ...(classBadges.length > 0 ? [`<Badges items=${attr(classBadges)} />`, ''] : []),
        markdown(rest(cls.description), ctx),
      ];
  const functions = cls.functions.filter(visible);
  const returned = [...functions, ...cls.types.filter(visible)].filter((item) => ctx.returned.has(item));
  const others = functions.filter((fn) => !ctx.returned.has(fn));
  // functions with a page of their own are only listed in the summary, linking to it
  const detailed = others.filter((fn) => !ctx.split.has(fn));

  return [
    ...intro,
    '',
    ...deprecation(cls, ctx),
    ...summarySection(cls, others, ctx, h),
    ...after,
    ...returnsSection(returned, cls, ctx, config, h),
    ...typeSection(cls, ctx, config, h),
    ...valueSection('Properties', cls.properties, cls, ctx, config, h),
    ...valueSection('Events', cls.events, cls, ctx, config, h),
    ...valueSection('Constants', cls.constants, cls, ctx, config, h),
    ...enumSection(cls, ctx, config, h),
    ...functionSection('Functions', detailed.filter((fn) => fn.functionKind !== 'method'), cls, ctx, config, h),
    ...functionSection('Methods', detailed.filter((fn) => fn.functionKind === 'method'), cls, ctx, config, h),
  ];
}

function filePage(title, classes, ctx, config, { icon, intro, outro, repository, lastModified }) {
  const nested = classes.length > 1;
  const source = nested ? undefined : sourceUrl(classes[0].source, config);
  pageTags = {};
  const body = classes.flatMap((cls) => classBody(cls, ctx, config, nested, nested ? [] : intro));
  const memberTags = pageTags;
  pageTags = null;
  heading = null;
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(summary(classes[0].description))}`,
    ...(icon ? [`icon: ${JSON.stringify(icon)}`] : []),
    ...(source ? [`source: ${JSON.stringify(source)}`] : []),
    ...(repository ? [`repository: ${JSON.stringify(repository)}`] : []),
    ...(lastModified ? [`lastModified: ${JSON.stringify(lastModified)}`] : []),
    ...(Object.keys(memberTags).length > 0 ? [`memberTags: ${JSON.stringify(memberTags)}`] : []),
    '---',
    '',
    '{/* @generated by scripts/generate.mjs from fumablox. Do not edit this file. */}',
    '',
    // A single class describes the module, so the intro follows its description.
    ...(nested ? intro : []),
    ...body,
    ...outro,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

// The page of a function that has a module of its own, like `Observe.attribute` in
// `src/attribute.luau`: its signature, description and examples under the function's name.
function functionPage(fn, cls, ctx, config, { repository, lastModified }) {
  const source = sourceUrl(fn.source, config);
  return [
    '---',
    `title: ${JSON.stringify(fn.name)}`,
    `description: ${JSON.stringify(summary(fn.description))}`,
    `icon: "SquareFunction"`,
    ...(source ? [`source: ${JSON.stringify(source)}`] : []),
    ...(repository ? [`repository: ${JSON.stringify(repository)}`] : []),
    ...(lastModified ? [`lastModified: ${JSON.stringify(lastModified)}`] : []),
    '---',
    '',
    '{/* @generated by scripts/generate.mjs from fumablox. Do not edit this file. */}',
    '',
    // the source is linked next to the title, so the badges leave it out
    ...functionBody(fn, { owner: cls.name, separator: '.', name: fn.name }, ctx, { ...config, gitRepoUrl: undefined }),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const isInit = (name) => /^init\.luau?$/.test(name);
const stem = (name) => name.replace(/\.luau?$/, '');
const byKey = ([a], [b]) => a.localeCompare(b);

// Source files as Rojo sees them: a folder with an init.luau is that module, and the other
// files next to it are its children.
function buildTree(paths) {
  const root = { dirs: new Map(), files: new Map() };
  for (const rel of paths) {
    const parts = rel.split('/');
    const name = parts.pop();
    let node = root;
    for (const part of parts) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: new Map() });
      node = node.dirs.get(part);
    }
    if (isInit(name)) node.init = rel;
    else node.files.set(name, rel);
  }
  return root;
}

const isLeaf = (node) => node.files.size + node.dirs.size === 0;

function writeMeta(dir, meta) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
}

// Lays the modules of a tree node out inside `dir`, each named like its Rojo instance. A
// folder module with children becomes a Fumadocs folder whose index.mdx is the module itself,
// so clicking the folder opens it; one without children is a plain page. Collects every page
// as { rel, file, title } and returns the entries for the parent's meta.json.
function layoutChildren(node, dir, pages, names) {
  const entries = [];
  for (const [name, rel] of [...node.files].sort(byKey)) {
    // a file holding one class is named after it, like `LifeStream` for Stream's core.luau
    const title = names.get(rel) ?? stem(name);
    const page = names.has(rel) ? kebab(title) : stem(name);
    pages.push({ rel, file: path.join(dir, `${page}.mdx`), title });
    entries.push(page);
  }
  for (const [name, child] of [...node.dirs].sort(byKey)) {
    if (child.init && isLeaf(child)) {
      pages.push({ rel: child.init, file: path.join(dir, `${name}.mdx`), title: name });
    } else {
      const into = path.join(dir, name);
      if (child.init) pages.push({ rel: child.init, file: path.join(into, 'index.mdx'), title: name });
      writeMeta(into, { title: name, pages: layoutChildren(child, into, pages, names) });
    }
    entries.push(name);
  }
  return entries;
}

// The library itself: a single module is one page named after the library. Otherwise it is a
// folder listing its modules, with the root init.luau first under the library's name.
function layoutLibrary(root, outRoot, slug, title, pages, icon, names) {
  if (root.init && isLeaf(root)) {
    pages.push({ rel: root.init, file: path.join(outRoot, `${slug}.mdx`), title, icon });
    return;
  }
  if (!root.init && root.dirs.size === 0 && root.files.size === 1) {
    const [rel] = root.files.values();
    pages.push({ rel, file: path.join(outRoot, `${slug}.mdx`), title, icon });
    return;
  }

  const dir = path.join(outRoot, slug);
  const entries = [];
  if (root.init) {
    pages.push({ rel: root.init, file: path.join(dir, 'index.mdx'), title });
    entries.push('index');
  }
  writeMeta(dir, { title, ...(icon ? { icon } : {}), pages: [...entries, ...layoutChildren(root, dir, pages, names)] });
}

const urlOf = (file, outRoot) =>
  ['', ...path.relative(outRoot, file).replace(/\.mdx$/, '').split(path.sep).filter((s) => s !== 'index')].join('/');

// Splits `a, b: (x, y) -> z` on the commas that are not nested in brackets. The `>` of `->`
// is not a closing bracket.
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('([{<'.includes(c)) depth++;
    else if (')]}'.includes(c) || (c === '>' && text[i - 1] !== '-')) depth--;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

// Parameters and return values of a one-line function definition such as
// `return function<T...>(callback: (T...) -> (), ...: T...): thread`.
function parseSignature(line) {
  const open = line.match(/function\s*[\w.:]*\s*(?:<[^()]*>)?\s*\(/);
  if (!open) return undefined;
  let depth = 0;
  let close = open.index + open[0].length;
  for (; close < line.length; close++) {
    const c = line[close];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) break;
      depth--;
    }
  }
  const params = splitTopLevel(line.slice(open.index + open[0].length, close)).map((param) => {
    const colon = param.indexOf(':');
    return colon === -1
      ? { name: param, description: '' }
      : { name: param.slice(0, colon).trim(), luaType: param.slice(colon + 1).trim(), description: '' };
  });
  const ret = line.slice(close + 1).match(/^\s*:\s*(.+?)\s*(?:--.*)?$/)?.[1];
  return { params, returns: ret ? [{ luaType: ret, description: '' }] : [] };
}

// Doc entries (functions or types) that describe the module's return value: their comment is
// followed by `return function(...)`, or by `local function name` with the file ending in
// `return name`. Maps each one to the signature read from that function.
function moduleReturns(classes, dir) {
  const returned = new Map();
  const files = new Map();
  const lines = (file) => {
    if (!files.has(file)) {
      const full = path.join(dir ?? '', file);
      files.set(file, dir && fs.existsSync(full) ? fs.readFileSync(full, 'utf8').split(/\r?\n/) : []);
    }
    return files.get(file);
  };
  for (const cls of classes) {
    for (const item of [...cls.functions, ...cls.types]) {
      const source = lines(item.source.path);
      const next = source.slice(item.source.endLine).find((line) => line.trim() !== '')?.trim() ?? '';
      const last = source.findLast((line) => line.trim() !== '')?.trim() ?? '';
      const local = next.match(/^(?:local\s+)?function\s+([A-Za-z_]\w*)\s*[<(]/);
      if (/^return\s+function\b/.test(next) || (local && last === `return ${local[1]}`)) {
        returned.set(item, parseSignature(next) ?? { params: [], returns: [] });
      }
    }
  }
  return returned;
}

// Placeholder base url for fumablox's resolver: links come back as `@@/Class#member` and are
// pointed at the page of the file declaring the class once every page is laid out.
const LINK_BASE = '@@';

// Writes one page per documented source file of a library under `outRoot` (served at the root, like /clock),
// laid out like its source tree. `intro` and `outro` go at the top and bottom of its first
// page; every page links to `repository` and gets its source file's date from `lastModified`.
// `siblings` maps the other libraries' names to their pages, for links like [Connection].
// Returns the url of the first page.
export function writeApiPages(
  extract,
  config,
  { dir, outRoot, slug, title, icon, intro = [], outro = [], repository, lastModified = new Map(), siblings = {} },
) {
  const classes = extract.classes.filter(visible).sort(byName);
  const typeNames = new Map();
  const externals = { ...siblings };
  for (const cls of classes) {
    for (const type of cls.types) typeNames.set(type.name, cls.name);
    Object.assign(externals, cls.externals);
  }

  const ctx = {
    classNames: new Set(classes.map((cls) => cls.name)),
    typeNames,
    memberAnchors: new Map(),
    externals,
    siblings,
    baseUrl: LINK_BASE,
    robloxLinks: config.robloxLinks ?? true,
    returned: moduleReturns(classes, dir),
  };

  // Classes grouped by source file, relative to the code folder they live in.
  const codeDirs = [config.code ?? 'src'].flat().map((dir) => dir.replace(/^\.\//, '').replace(/\/$/, ''));
  const byFile = new Map();
  for (const cls of classes) {
    const file = cls.source.path.replaceAll('\\', '/');
    const dir = codeDirs.find((d) => file.startsWith(`${d}/`));
    const rel = dir ? file.slice(dir.length + 1) : file;
    if (!byFile.has(rel)) byFile.set(rel, []);
    byFile.get(rel).push(cls);
  }

  // A function documented in a module of its own, named like it, gets its own page next to its
  // class, like `src/attribute.luau` for `Observe.attribute`.
  const relative = (file) => {
    const dir = codeDirs.find((d) => file.startsWith(`${d}/`));
    return dir ? file.slice(dir.length + 1) : file;
  };
  const splitByFile = new Map();
  for (const cls of classes) {
    const classFile = cls.source.path.replaceAll('\\', '/');
    for (const fn of cls.functions.filter(visible)) {
      const file = fn.source.path.replaceAll('\\', '/');
      const rel = relative(file);
      if (file === classFile || byFile.has(rel) || splitByFile.has(rel)) continue;
      if (stem(path.basename(rel)) !== fn.name) continue;
      splitByFile.set(rel, { cls, fn });
      // its module returns it, but it is reached through its class, like `Observe.attribute`
      ctx.returned.delete(fn);
    }
  }
  ctx.split = new Map();

  const pages = [];
  // the page of a file that is not a module's init and holds a single class takes that class's name
  const names = new Map();
  for (const [rel, fileClasses] of byFile) {
    if (!isInit(path.basename(rel)) && fileClasses.length === 1) names.set(rel, fileClasses[0].name);
  }
  layoutLibrary(buildTree([...byFile.keys(), ...splitByFile.keys()]), outRoot, slug, title, pages, icon, names);

  const targets = new Map();
  // `Class.member` of the functions with a page of their own, to their page
  const memberTargets = new Map();
  for (const page of pages) {
    const split = splitByFile.get(page.rel);
    if (split) {
      const url = urlOf(page.file, outRoot);
      ctx.split.set(split.fn, { url });
      memberTargets.set(`${split.cls.name}.${split.fn.name}`, url);
      continue;
    }
    const pageClasses = byFile.get(page.rel);
    for (const cls of pageClasses) {
      targets.set(cls.name, { url: urlOf(page.file, outRoot), nested: pageClasses.length > 1 });
    }
  }
  const resolve = (text) =>
    text.replace(/@@\/([A-Za-z_]\w*)(?:#([\w.]+))?/g, (match, name, member) => {
      const target = targets.get(name);
      if (!target) return match;
      if (member && memberTargets.has(`${name}.${member}`)) return memberTargets.get(`${name}.${member}`);
      if (member) return `${target.url}#${target.nested ? `${name}-${member}` : member}`;
      return target.nested ? `${target.url}#${name}` : target.url;
    });

  pages.forEach((page, i) => {
    fs.mkdirSync(path.dirname(page.file), { recursive: true });
    const split = splitByFile.get(page.rel);
    if (split) {
      const content = functionPage(split.fn, split.cls, ctx, config, {
        repository,
        lastModified: lastModified.get(split.fn.source.path.replaceAll('\\', '/')),
      });
      fs.writeFileSync(page.file, resolve(content));
      return;
    }
    const classes = byFile.get(page.rel);
    const content = filePage(page.title, classes, ctx, config, {
      icon: page.icon,
      intro: i === 0 ? intro : [],
      outro: i === 0 ? outro : [],
      repository,
      lastModified: lastModified.get(classes[0].source.path.replaceAll('\\', '/')),
    });
    fs.writeFileSync(page.file, resolve(content));
  });

  return pages[0] ? urlOf(pages[0].file, outRoot) : `/${slug}`;
}
