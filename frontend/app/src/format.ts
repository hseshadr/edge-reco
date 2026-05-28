/**
 * Formats a product price using its ISO currency code. Returns a graceful
 * placeholder when the price is null (catalog items without pricing yet).
 */
export function formatPrice(price: number | null, currency: string): string {
	if (price === null) {
		return "Price on request";
	}
	const code = currency.trim() === "" ? "USD" : currency;
	try {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency: code,
		}).format(price);
	} catch {
		return `${code} ${price.toFixed(2)}`;
	}
}
