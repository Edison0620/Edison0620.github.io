'use strict';

(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SiteParticleAtlas = api;
})(typeof window === 'undefined' ? null : window, function() {
  function packAtlas(rectangles, options = {}) {
    const maxSize = options.maxSize || 2048;
    const padding = options.padding ?? 2;
    const maxPages = options.maxPages || 4;
    const pages = [];
    const placements = [];
    let page;

    function startPage() {
      if (pages.length >= maxPages) {
        throw new Error('atlas page limit exceeded');
      }
      page = { width: 0, height: 0, x: padding, y: padding, shelfHeight: 0 };
      pages.push(page);
    }

    for (const rectangle of rectangles) {
      const width = rectangle.width;
      const height = rectangle.height;
      if (width + (padding * 2) > maxSize
        || height + (padding * 2) > maxSize) {
        throw new Error('tile exceeds atlas page bounds');
      }
      if (!page) startPage();
      if (page.x + width + padding > maxSize) {
        const nextShelfY = page.y + page.shelfHeight + padding;
        if (nextShelfY + height + padding > maxSize) {
          startPage();
        } else {
          page.x = padding;
          page.y = nextShelfY;
          page.shelfHeight = 0;
        }
      }
      if (page.y + height + padding > maxSize) {
        startPage();
      }
      placements.push({
        page: pages.length - 1,
        x: page.x,
        y: page.y,
        width,
        height
      });
      page.width = Math.max(page.width, page.x + width + padding);
      page.height = Math.max(page.height, page.y + height + padding);
      page.x += width + padding;
      page.shelfHeight = Math.max(page.shelfHeight, height);
    }

    return {
      pages: pages.map(({ width, height }) => ({ width, height })),
      placements
    };
  }

  async function buildVisualAtlas(visuals, options) {
    const dpr = options.dpr || 1;
    const rectangles = visuals.map(visual => ({
      width: Math.max(1, Math.ceil(visual.w * dpr)),
      height: Math.max(1, Math.ceil(visual.h * dpr))
    }));
    const layout = packAtlas(rectangles, options);
    const canvases = layout.pages.map(page => {
      const canvas = options.createCanvas(page.width, page.height);
      const context = canvas.getContext('2d');
      return { canvas, context };
    });

    layout.placements.forEach((placement, index) => {
      options.drawVisual(
        canvases[placement.page].context,
        visuals[index],
        placement
      );
    });

    const pages = [];
    try {
      for (const { canvas } of canvases) {
        pages.push(await options.createImageBitmap(canvas));
      }
    } catch (error) {
      for (const bitmap of pages) {
        if (bitmap && typeof bitmap.close === 'function') bitmap.close();
      }
      throw error;
    }
    const entries = layout.placements.map(placement => {
      const page = layout.pages[placement.page];
      return {
        page: placement.page,
        u0: placement.x / page.width,
        v0: placement.y / page.height,
        u1: (placement.x + placement.width) / page.width,
        v1: (placement.y + placement.height) / page.height
      };
    });
    return { pages, entries };
  }

  return { packAtlas, buildVisualAtlas };
});
