// Cloudflare Pages advanced-mode worker.
// Keep the public hostname canonical without requiring a separate zone rule.
export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		if (url.hostname.toLowerCase() === "www.edge-reco.com") {
			url.hostname = "edge-reco.com";
			return Response.redirect(url.toString(), 308);
		}
		return env.ASSETS.fetch(request);
	},
};
