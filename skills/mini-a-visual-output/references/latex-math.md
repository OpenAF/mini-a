# LaTeX math in responses

Use `usemath=true`. Mini-A renders mathematical expressions through KaTeX in the web UI; this is not a full LaTeX document compiler. Write inline `$...$` or display `$$...$$` outside code fences. Do not emit a `latex` fence, document preamble, `\documentclass`, or package imports for rendered response math.

## Inline formula

The area of a circle is $A = \pi r^2$, where $r$ is its radius.

## Display equation

$$\bar{x} = \frac{1}{n}\sum_{i=1}^{n} x_i$$

The mean sums the observations and divides by their count.

## Aligned derivation

$$\begin{aligned}2x + 4 &= 10 \cr 2x &= 6 \cr x &= 3\end{aligned}$$

Each line applies the same operation to both sides of the equation.

## Matrix

$$M = \begin{bmatrix}1 & 2 \cr 3 & 4\end{bmatrix}$$

This illustrative matrix has two rows and two columns.

## Checks and fallback

Keep each complete `$$...$$` expression on one Markdown source line, separated from prose by blank lines: the current Markdown extension does not reliably recognize multiline display blocks. Use `\cr` for aligned/matrix row separators; Markdown processing can collapse `\\` before KaTeX sees it. Balance dollar delimiters, braces, and `\begin`/`\end` pairs. Use KaTeX-supported commands such as `\frac`, `\sqrt`, `\sum`, `\text`, `aligned`, and `bmatrix`; do not assume arbitrary LaTeX packages or custom macros are available. Define symbols and state units and assumptions. Verify the mathematics as well as the syntax.

Use literal backslashes in Markdown math (`\frac`, not `\\frac`); double them only when serializing through a JSON string. Ordinary currency should remain prose outside math delimiters.

KaTeX and its Markdown extension depend on browser assets. If rendering is unavailable, retain readable formula source and explain it in words. Do not claim successful rendering from balanced delimiters alone; inspect the actual output for errors when a browser is available.
