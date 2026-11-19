import { getDocument, GlobalWorkerOptions } from '@prototype/node_modules/pdfjs-dist/build/pdf.mjs';
import workerUrl from '@prototype/node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parsePdfDocument } from '@prototype/src/pdf/parser-core.js';
import { matchInvoicesToItineraries } from '@prototype/src/pdf/matcher.js';
import { inferItineraryCities } from '@prototype/public/cities.js';

import { normalizeTrip, summarizeTripRemark } from './trip-display.mjs';

import { alignTripTableRows } from './trip-table.mjs';

GlobalWorkerOptions.workerSrc = workerUrl;

export async function analyzeMaterials(files) {
  const parsed = [];
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.pdf') || file.size > 20 * 1024 * 1024) {
      throw new Error(`请选择 20 MB 以内的电子 PDF（${file.name}）。`);
    }
    const document = await getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    try {
      parsed.push(await parsePdfDocument(alignTripTableRows(document), file.name));
    } finally {
      await document.destroy();
    }
  }
  const invoices = parsed.filter(file => file.kind === 'invoice');
  const itineraries = parsed.filter(file => file.kind === 'itinerary')
    .map(file => ({ ...file, trips: file.trips.map(normalizeTrip) }));
  if (!invoices.length || invoices.length > 10) {
    throw new Error('每次需要 1–10 张可识别的电子发票。');
  }
  const { matches, unmatchedItineraries } = matchInvoicesToItineraries(invoices, itineraries);
  return {
    unused: [...parsed.filter(file => file.kind !== 'invoice' && file.kind !== 'itinerary'), ...unmatchedItineraries]
      .map(file => file.fileName),
    matches: matches.map(match => ({
      ...match,
      ...inferItineraryCities(match.itinerary),
      dateFrom: match.itinerary?.dateFrom || '',
      dateTo: match.itinerary?.dateTo || '',
      remark: summarizeTripRemark(match.itinerary?.trips || []),
    })),
  };
}
