import { encode, decode } from 'html-entities';
import { obj as bpeVocabData, extra_vocab } from './bpe_tokens';
function ord(c: string) {
	return c.charCodeAt(0);
}
function range(start: number, stop: number | undefined = undefined, step: number = 1): number[] {
	if (stop === undefined) {
		stop = start;
		start = 0;
	}

	if ((step > 0 && start >= stop) || (step < 0 && start <= stop)) {
		return [];
	}

	const result: number[] = [];
	for (let i = start; step > 0 ? i < stop : i > stop; i += step) {
		result.push(i);
	}

	return result;
}

function bytesToUnicode() {
	let bs = [
		...range(ord('!'), ord('~') + 1),
		...range(ord('¡'), ord('¬') + 1),
		...range(ord('®'), ord('ÿ') + 1),
	];
	let cs: (number | string)[] = bs.slice(0);
	let n = 0;
	for (let b of range(2 ** 8)) {
		if (!bs.includes(b)) {
			bs.push(b);
			cs.push(2 ** 8 + n);
			n += 1;
		}
	}
	cs = cs.map((n) => String.fromCharCode(Number.parseInt(n as any)));
	return Object.fromEntries(bs.map((v, i) => [v, cs[i]]));
}

function getPairs(word: string | string[]) {
	let pairs: string[][] = [];
	let prevChar = word[0];
	for (let char of word.slice(1)) {
		pairs.push([prevChar, char]);
		prevChar = char;
	}
	return pairs;
}

function basicClean(text: string | null | undefined) {
	// text = ftfy.fix_text(text);
	text = decode(text);
	return text.trim();
}

function whitespaceClean(text: string) {
	return text.replace(/\s+/g, ' ').trim();
}

export default class {
	byteEncoder: { [key: string]: number | string };
	byteDecoder: { [key: number]: string };
	encoder: { [k: string]: number };
	decoder: { [k: string]: string };
	bpeRanks: { [k: string]: any };
	cache: { '<|startoftext|>': string; '<|endoftext|>': string };
	pat: RegExp;
	padTokenId: number;
	endTokenId: number;
	startTokenId: number;
	constructor() {
		this.byteEncoder = bytesToUnicode();
		this.byteDecoder = Object.fromEntries(Object.entries(this.byteEncoder).map(([k, v]) => [v, k]));
		let merges: string[] | string[][] = bpeVocabData.text.split('\n');
		merges = merges.slice(1, 49152 - 256 - 2 + 1);
		merges = merges.map((merge: string) => merge.split(' '));
		// There was a bug related to the ordering of Python's .values() output. I'm lazy do I've just copy-pasted the Python output:
		let vocab = extra_vocab;
		vocab = [...vocab, ...vocab.map((v) => v + '</w>')];
		for (let merge of merges) {
			vocab.push(merge.join(''));
		}
		vocab.push('<|startoftext|>', '<|endoftext|>');
		this.encoder = Object.fromEntries(vocab.map((v, i) => [v, i]));
		this.decoder = Object.fromEntries(Object.entries(this.encoder).map(([k, v]) => [v, k]));
		this.bpeRanks = Object.fromEntries(merges.map((v: any[], i: any) => [v.join('·😎·'), i])); // ·😎· because js doesn't yet have tuples
		this.cache = { '<|startoftext|>': '<|startoftext|>', '<|endoftext|>': '<|endoftext|>' };
		this.pat =
			/<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/giu;
		this.padTokenId = 49406;
		this.startTokenId = 49408;
		this.endTokenId = 49406;
	}

	bpe(token: string) {
		if (this.cache[token] !== undefined) {
			return this.cache[token];
		}

		let word: string[] | string = [...token.slice(0, -1), token.slice(-1) + '</w>'];
		let pairs = getPairs(word);

		if (pairs.length === 0) {
			return token + '</w>';
		}

		while (1) {
			let bigram: any = null;
			let minRank: any = Infinity;
			for (let p of pairs) {
				let r = this.bpeRanks[p.join('·😎·')];
				if (r === undefined) continue;
				if (r < minRank) {
					minRank = r;
					bigram = p;
				}
			}

			if (bigram === null) {
				break;
			}

			let [first, second] = bigram;
			let newWord: string[] = [];
			let i = 0;
			while (i < word.length) {
				let j = word.indexOf(first, i);

				if (j === -1) {
					newWord.push(...word.slice(i));
					break;
				}

				newWord.push(...word.slice(i, j));
				i = j;

				if (word[i] === first && i < word.length - 1 && word[i + 1] === second) {
					newWord.push(first + second);
					i += 2;
				} else {
					newWord.push(word[i]);
					i += 1;
				}
			}
			word = newWord;
			if (word.length === 1) {
				break;
			} else {
				pairs = getPairs(word);
			}
		}
		word = word.join(' ');
		this.cache[token] = word;
		return word;
	}

	encode(text: string) {
		let bpeTokens: number[] = [];
		text = whitespaceClean(basicClean(text)).toLowerCase();
		for (let token of [...text.matchAll(this.pat)].map((m) => m[0])) {
			token = [...token].map((b) => this.byteEncoder[b.charCodeAt(0)]).join('');
			bpeTokens.push(
				...this.bpe(token)
					.split(' ')
					.map((bpe_token: string | number) => this.encoder[bpe_token])
			);
		}
		return bpeTokens;
	}

	// adds start and end token, and adds padding 0's and ensures it's 77 tokens long
	encodeForCLIP(text: any, max_length = 77) {
		if (max_length % 77 != 0) {
			throw new RangeError('max_length must be divisible by 77');
		}
		let tokens = this.encode(text);
		tokens.unshift(49406); // start token
		tokens = tokens.slice(0, 76);
		tokens.push(49407); // end token
		while (tokens.length < max_length) tokens.push(49407);
		return tokens;
	}

	decode(tokens: number[]) {
		let text = tokens.map((token: string | number) => this.decoder[token]).join('');
		text = [...text]
			.map((c) => this.byteDecoder[c])
			.map((v) => String.fromCharCode(v))
			.join('')
			.replaceAll('</w>', ' ');
		return text;
	}
}
