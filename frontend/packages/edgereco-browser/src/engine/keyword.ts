// In-browser BM25 keyword search. A faithful port of rank_bm25's BM25Okapi (the
// engine edge-reco's KeywordSearcher wraps via EdgeProc), including its
// epsilon-floored IDF: terms in more than half the corpus get a negative raw IDF,
// which BM25Okapi replaces with `epsilon * average_idf` (average over the RAW
// idfs, negatives included). Defaults match the Python lib: k1=1.5, b=0.75,
// epsilon=0.25.
//
// The corpus text mirrors edge-reco's reco projection (search/keyword.py
// _product_tokens): title + category + tags + brand, lowercased and split on
// whitespace. search() ranks descending, breaks ties by ascending corpus index
// (Python's stable sort over enumerate), and returns only strictly-positive
// scores — matching EdgeProc's KeywordSearcher.search.

import type { Product } from "./domain";

/** BM25Okapi hyperparameters; defaults mirror rank_bm25. */
export interface Bm25Params {
	readonly k1: number;
	readonly b: number;
	readonly epsilon: number;
}

export const DEFAULT_BM25_PARAMS: Bm25Params = {
	k1: 1.5,
	b: 0.75,
	epsilon: 0.25,
};

/** A keyword hit: a product id and its BM25 score. */
export interface KeywordHit {
	readonly id: string;
	readonly score: number;
}

/** Lowercase + split on whitespace — rank_bm25's default tokenizer and the
 * tokenization EdgeProc's KeywordSearcher uses (`text.lower().split()`). */
export function tokenize(text: string): ReadonlyArray<string> {
	const trimmed = text.trim();
	return trimmed.length === 0 ? [] : trimmed.toLowerCase().split(/\s+/);
}

/** The reco text projection: title + category + tags + brand (search/keyword.py
 * _product_tokens), the exact field set the Python corpus is built from. */
export function productTokens(product: Product): ReadonlyArray<string> {
	const parts = [product.title, product.category, ...product.tags];
	if (product.brand) {
		parts.push(product.brand);
	}
	return tokenize(parts.join(" "));
}

/** BM25 over a fixed corpus of token lists, addressed by parallel ids. */
export class KeywordSearcher {
	readonly #ids: ReadonlyArray<string>;
	readonly #docFreqs: ReadonlyArray<ReadonlyMap<string, number>>;
	readonly #docLen: ReadonlyArray<number>;
	readonly #idf: ReadonlyMap<string, number>;
	readonly #avgdl: number;
	readonly #params: Bm25Params;

	private constructor(
		ids: ReadonlyArray<string>,
		docFreqs: ReadonlyArray<ReadonlyMap<string, number>>,
		docLen: ReadonlyArray<number>,
		idf: ReadonlyMap<string, number>,
		avgdl: number,
		params: Bm25Params,
	) {
		this.#ids = ids;
		this.#docFreqs = docFreqs;
		this.#docLen = docLen;
		this.#idf = idf;
		this.#avgdl = avgdl;
		this.#params = params;
	}

	/** Build the index from already-tokenized documents and parallel ids. */
	public static fromCorpus(
		corpus: ReadonlyArray<ReadonlyArray<string>>,
		ids: ReadonlyArray<string>,
		params: Bm25Params = DEFAULT_BM25_PARAMS,
	): KeywordSearcher {
		const docFreqs: Map<string, number>[] = [];
		const docLen: number[] = [];
		const nd = new Map<string, number>(); // word -> #docs containing it
		let totalLen = 0;
		for (const document of corpus) {
			docLen.push(document.length);
			totalLen += document.length;
			const frequencies = new Map<string, number>();
			for (const word of document) {
				frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
			}
			docFreqs.push(frequencies);
			for (const word of frequencies.keys()) {
				nd.set(word, (nd.get(word) ?? 0) + 1);
			}
		}
		const corpusSize = corpus.length;
		const avgdl = corpusSize === 0 ? 0 : totalLen / corpusSize;
		const idf = computeIdf(nd, corpusSize, params.epsilon);
		return new KeywordSearcher(ids, docFreqs, docLen, idf, avgdl, params);
	}

	/** Build from products using the reco text projection. */
	public static fromProducts(
		products: ReadonlyArray<Product>,
		params: Bm25Params = DEFAULT_BM25_PARAMS,
	): KeywordSearcher {
		return KeywordSearcher.fromCorpus(
			products.map((p) => productTokens(p)),
			products.map((p) => p.id),
			params,
		);
	}

	/** BM25 scores for every doc, parallel to the corpus order. */
	#scores(queryTokens: ReadonlyArray<string>): Float64Array {
		const { k1, b } = this.#params;
		const scores = new Float64Array(this.#ids.length);
		for (const q of queryTokens) {
			const idf = this.#idf.get(q) ?? 0;
			if (idf === 0) {
				continue;
			}
			for (let i = 0; i < this.#docFreqs.length; i += 1) {
				const qf = this.#docFreqs[i]?.get(q) ?? 0;
				if (qf === 0) {
					continue;
				}
				const dl = this.#docLen[i] ?? 0;
				const denom = qf + k1 * (1 - b + (b * dl) / this.#avgdl);
				scores[i] = (scores[i] ?? 0) + idf * ((qf * (k1 + 1)) / denom);
			}
		}
		return scores;
	}

	/**
	 * Top-k keyword hits with strictly-positive scores, ranked descending with
	 * ties broken by ascending corpus index. Empty query or empty corpus -> [].
	 */
	public search(query: string, k = 10): ReadonlyArray<KeywordHit> {
		const queryTokens = tokenize(query);
		if (queryTokens.length === 0 || this.#ids.length === 0) {
			return [];
		}
		const scores = this.#scores(queryTokens);
		const ranked: { index: number; score: number }[] = [];
		for (let i = 0; i < scores.length; i += 1) {
			ranked.push({ index: i, score: scores[i] ?? 0 });
		}
		ranked.sort((a, b) => b.score - a.score || a.index - b.index);
		const hits: KeywordHit[] = [];
		for (const { index, score } of ranked) {
			if (hits.length >= k) {
				break;
			}
			if (score > 0) {
				hits.push({ id: this.#ids[index] ?? "", score });
			}
		}
		return hits;
	}
}

/** Reproduce BM25Okapi._calc_idf: raw IDF, then floor negatives to
 * epsilon * average_idf (average taken over the RAW idfs, negatives included). */
function computeIdf(
	nd: ReadonlyMap<string, number>,
	corpusSize: number,
	epsilon: number,
): ReadonlyMap<string, number> {
	const idf = new Map<string, number>();
	const negatives: string[] = [];
	let idfSum = 0;
	for (const [word, freq] of nd) {
		const value = Math.log(corpusSize - freq + 0.5) - Math.log(freq + 0.5);
		idf.set(word, value);
		idfSum += value;
		if (value < 0) {
			negatives.push(word);
		}
	}
	if (idf.size === 0) {
		return idf;
	}
	const averageIdf = idfSum / idf.size;
	const floor = epsilon * averageIdf;
	for (const word of negatives) {
		idf.set(word, floor);
	}
	return idf;
}
