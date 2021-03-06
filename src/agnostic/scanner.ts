import { assertMin, assertRange } from './errors';
import { Characters, splitLines } from './strings';

/**
 * Represents a line of @member text with a @member line number.
 */
export interface IndexedLine {
  line: number;
  text: string;
}

/**
 * Represents a section of @member text.
 *
 * Contains enough information in order to represent actionable error or
 * informational messages. Some members in some implementations may be lazy.
 *
 * @see StringSpan for the default implementation.
 */
export interface ISourceSpan {
  /**
   * Character offset of the span.
   */
  offset: number;

  /**
   * Column within the @member line the @member offset appears.
   */
  column: number;

  /**
   * Line within the input file the @member offset appears.
   */
  line: number;

  /**
   * Text of the span.
   */
  text: string;

  /**
   * Length of @member text.
   */
  length: number;

  /**
   * Whether @member text spans over more than one line.
   */
  isMultiLine: boolean;

  /**
   * Lines within the @member text.
   *
   * **WARNING**: @member isMultiLine should be used before accessing this.
   */
  lines(): IndexedLine[];
}

/**
 * Partial implementation of @see SourceSpan.
 */
export abstract class AbstractSpan implements ISourceSpan {
  private static readonly matchNewLine = /\n|\r/;

  public abstract get offset(): number;
  public abstract get column(): number;
  public abstract get line(): number;
  public abstract get text(): string;

  public get length(): number {
    return this.text.length;
  }

  public lines(): IndexedLine[] {
    return this.computeMultiLines();
  }

  public get isMultiLine(): boolean {
    return AbstractSpan.matchNewLine.test(this.text);
  }

  private computeMultiLines(): IndexedLine[] {
    return Array.from(
      splitLines(this.text).map((text, index) => {
        return {
          line: this.line + index,
          text,
        };
      })
    );
  }
}

/**
 * Represents a section of @member text in memory.
 */
export class StringSpan extends AbstractSpan {
  constructor(
    public readonly offset: number,
    public readonly column: number,
    public readonly line: number,
    public readonly text: string
  ) {
    super();
    assertMin('offset', offset);
    assertMin('column', column);
    assertMin('line', line);
  }
}

/**
 * An input file loaded in memory.
 */
export class SourceFile {
  /**
   * Length of the file in characters.
   */
  public get length(): number {
    return this.contents.length;
  }

  private get lineStarts(): number[] {
    this.computeLineStarts();
    return this.mLineStartsCache!;
  }
  /**
   * An array of offsets for each line beginning in the file.
   *
   * Each offset refers to the first character *after* the newline. If the
   * source file has a trailing newline, the final offset won't actually be in
   * the file.
   */
  private mLineStartsCache?: number[];

  constructor(
    public readonly contents: string,
    public readonly sourceUrl?: string
  ) {}

  /**
   * Returns a span from the provided @member start -> @member end.
   */
  public span(start: number, end: number): ISourceSpan {
    this.assertValidOffset(start);
    this.assertValidOffset(end);
    if (end < start) {
      throw new RangeError(
        `End offset ${end} should be >= start offset ${start}.`
      );
    }
    return new FileSpan(this, start, this.contents.substring(start, end));
  }

  /**
   * Returns the line number given @param offset.
   */
  public computeLine(offset: number): number {
    this.assertValidOffset(offset);
    if (offset < this.lineStarts[0]) {
      return 0;
    }
    if (offset >= this.lineStarts[this.lineStarts.length - 1]) {
      return this.lineStarts.length;
    }
    return this.binarySearch(offset);
  }

  /**
   * Returns the column number given @param offset.
   */
  public computeColumn(offset: number): number {
    this.assertValidOffset(offset);
    const line = this.computeLine(offset) - 1;
    const start = this.lineStarts[line] || 0;
    return offset - start;
  }

  private assertValidOffset(offset: number): void {
    if (offset < 0) {
      throw new RangeError(`Offset may not be negative, was ${offset}.`);
    }
    if (offset > this.length) {
      throw new RangeError(
        `Offset ${offset} must not be greater than the length ${this.length}.`
      );
    }
  }

  /**
   * Binary search of @member lineStarts to find cooresponding @param offset.
   */
  private binarySearch(offset: number): number {
    let min = 0;
    let max = this.lineStarts.length - 1;
    while (min < max) {
      // tslint:disable-next-line:no-magic-numbers
      const half = Math.floor(min + (max - min) / 2);
      if (this.lineStarts[half] > offset) {
        max = half;
      } else {
        min = half + 1;
      }
    }
    return max;
  }

  private computeLineStarts(): void {
    if (this.mLineStartsCache) {
      return;
    }
    this.mLineStartsCache = [];
    for (let i = 0; i < this.length; i++) {
      let c = this.contents.charCodeAt(i);
      if (c === Characters.$CR) {
        const j = i + 1;
        if (
          j >= this.length ||
          this.contents.charCodeAt(j) !== Characters.$LF
        ) {
          c = Characters.$LF;
        }
      }
      if (c === Characters.$LF) {
        this.mLineStartsCache.push(i + 1);
      }
    }
  }
}

/**
 * A lazy implementation of @see SourceSpan backed by a @see SourceFile.
 */
export class FileSpan extends AbstractSpan {
  constructor(
    private readonly file: SourceFile,
    public readonly offset: number,
    public readonly text: string
  ) {
    super();
  }

  public get column() {
    return this.file.computeColumn(this.offset);
  }

  public get line() {
    return this.file.computeLine(this.offset);
  }
}

/**
 * A matching function for checking the type of @param char.
 */
type Matcher = (char: number) => boolean;

/**
 * A simple low-level scanner for incrementally reading data in a streaming manner.
 */
export class StringScanner {
  /**
   * Represents the file or content currently being read.
   */
  public readonly source: SourceFile;

  private mPosition = 0;

  constructor(data: string) {
    this.source = new SourceFile(data);
  }

  /**
   * Length of the data being read.
   */
  public get length(): number {
    return this.source.length;
  }

  /**
   * Current position of the scanner.
   */
  public get position(): number {
    return this.mPosition;
  }

  /**
   * Sets the current position of the scanner.
   */
  public set position(position: number) {
    assertRange('position', position, 0, this.length);
    this.mPosition = position;
  }

  /**
   * Returns a substring of the underlying data of @param start -> @param end.
   */
  public substring(start = this.position, end = this.length): string {
    return this.source.contents.substring(start, end);
  }

  /**
   * Returns whether additional characters have yet to be scanned.
   */
  public hasNext(): boolean {
    return this.position < this.length;
  }

  /**
   * Returns whether the next character is the same as @param pattern.
   *
   * If true, @member position is advanced by one.
   */
  public match(pattern: number): boolean;

  /**
   * Returns whether @param substring matches the beginning at @param position.
   *
   * If true, @member position is advanced by the length of the pattern string.
   */
  // tslint:disable-next-line:unified-signatures
  public match(substring: string): boolean;

  /**
   * Returns whether the next character is true when @param matcher is called.
   *
   * If true, @member position is advanced by one.
   */
  // tslint:disable-next-line:unified-signatures
  public match(matcher: Matcher): boolean;

  public match(pattern: string | number | Matcher): boolean {
    if (typeof pattern === 'string') {
      if (this.source.contents.startsWith(pattern, this.position)) {
        this.mPosition += pattern.length;
        return true;
      }
      return false;
    }
    const next = this.peek();
    if (typeof pattern === 'number' ? next === pattern : pattern(next)) {
      this.mPosition++;
      return true;
    }
    return false;
  }

  /**
   * Returns the next character and advances the position counter.
   */
  public advance(): number {
    return this.source.contents.charCodeAt(this.position++);
  }

  /**
   * Returns the next character.
   */
  public peek(offset = 0): number {
    return this.source.contents.charCodeAt(this.position + offset);
  }

  /**
   * Resets the @member position back to 0.
   */
  public reset(): void {
    this.position = 0;
  }
}
