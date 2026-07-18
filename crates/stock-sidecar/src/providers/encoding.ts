/**
 * 腾讯行情文本接口（qt.gtimg.cn 等）返回 GBK 编码且通常不带可靠的
 * charset 头；直接 response.text() 会按 UTF-8 解码产生 U+FFFD 乱码。
 * 这里按 content-type 判断：显式 utf-8 才用 utf-8，否则按 gb18030
 * （GBK 的超集）解码。与 sinafinance.ts 的 decodeSinaText 同一模式。
 */
export async function decodeGbkAwareText(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const encoding = /charset=(?:utf-8|utf8)/.test(contentType)
    ? "utf-8"
    : "gb18030";
  return new TextDecoder(encoding).decode(await response.arrayBuffer());
}
