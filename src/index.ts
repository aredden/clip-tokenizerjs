import BpeTokenizer from './bpe_tokenizer';

export default abstract class PromptLengthParser {
	static tokenizer: BpeTokenizer = new BpeTokenizer();
	static parseLength = (value?: string) => {
		if (!value) {
			return 0;
		} else {
			return this.tokenizer.encode(value).length;
		}
	};
}

async function main() {
	const parser = PromptLengthParser;
	console.log(parser.parseLength('I love to eat chickens!'));
}

main();
