export function alignTripTableRows(document) {
  return {
    numPages: document.numPages,
    async getPage(number) {
      const page = await document.getPage(number);
      return {
        async getTextContent() {
          const content = await page.getTextContent();
          const items = content.items.filter(item => item.str?.trim() && item.transform);
          const header = items.find(item => item.str.trim() === '序号');
          if (!header) return content;
          const [headerX, headerY] = header.transform.slice(4);
          const headers = items.filter(item => Math.abs(item.transform[5] - headerY) < 3);
          if (!['上车时间', '城市', '起点', '终点'].every(name =>
            headers.some(item => item.str.trim() === name))) return content;

          const rows = items.filter(item => /^\d{1,3}$/.test(item.str.trim())
            && Math.abs(item.transform[4] - headerX) <= (header.width || 18)
            && item.transform[5] < headerY - 10);
          const baselines = new Map();
          for (const item of items) {
            const y = item.transform[5];
            const nearest = rows.reduce((best, row) =>
              Math.abs(row.transform[5] - y) < Math.abs(best - y) ? row.transform[5] : best, Infinity);
            if (Math.abs(nearest - y) <= 9) baselines.set(item, nearest);
          }
          return {
            ...content,
            items: content.items.map(item => {
              if (!baselines.has(item)) return item;
              const transform = [...item.transform];
              transform[5] = baselines.get(item);
              return { ...item, transform };
            }),
          };
        },
      };
    },
  };
}
