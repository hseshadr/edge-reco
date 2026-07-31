"""Unit tests for the remote product-photo localizer.

These bytes come from an UNTRUSTED third-party CDN and land inside a SIGNED bundle,
so the validation is the security boundary: a content-type header is a claim, not
evidence, and only the magic bytes decide what a file actually is.
"""

from __future__ import annotations

import httpx
import pytest

from edgereco.catalog.image_download import (
    MAX_IMAGE_BYTES,
    ImageTooLargeError,
    NotAnImageError,
    fetch_product_photo,
    preview_url,
    validated_extension,
)

_JPEG = b"\xff\xd8\xff\xe0" + b"body"
_PNG = b"\x89PNG\r\n\x1a\n" + b"body"
_WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"body"


class TestValidatedExtension:
    def test_accepts_the_three_formats_a_browser_renders(self) -> None:
        assert validated_extension("image/jpeg", _JPEG) == "jpg"
        assert validated_extension("image/png", _PNG) == "png"
        assert validated_extension("image/webp", _WEBP) == "webp"

    def test_magic_bytes_beat_a_lying_content_type(self) -> None:
        # THE attack this exists for: an origin (or anything on the path) serves an
        # error page, a script, or a polyglot while claiming to be an image. Writing
        # that into a signed bundle would put attacker-chosen bytes behind our
        # signature. The declared type is never trusted on its own.
        with pytest.raises(NotAnImageError):
            validated_extension("image/jpeg", b"<!DOCTYPE html><html>nope</html>")
        with pytest.raises(NotAnImageError):
            validated_extension("image/png", _JPEG)  # real image, wrong type

    def test_rejects_svg_and_anything_scriptable(self) -> None:
        # SVG is XML and can carry script; it is never accepted from a REMOTE source.
        # (The locally GENERATED placeholder is a different, trusted path.)
        with pytest.raises(NotAnImageError):
            validated_extension("image/svg+xml", b"<svg onload=alert(1)/>")

    def test_rejects_an_empty_body(self) -> None:
        with pytest.raises(NotAnImageError):
            validated_extension("image/jpeg", b"")

    def test_content_type_parameters_are_tolerated(self) -> None:
        assert validated_extension("image/jpeg; charset=binary", _JPEG) == "jpg"
        assert validated_extension("IMAGE/JPEG", _JPEG) == "jpg"

    def test_rejects_a_body_over_the_size_cap(self) -> None:
        # An unbounded download is a build-time DoS and would bloat the signed bundle.
        with pytest.raises(ImageTooLargeError):
            validated_extension("image/jpeg", _JPEG + b"x" * MAX_IMAGE_BYTES)


class TestPreviewUrl:
    def test_rewrites_amazon_size_tokens_down(self) -> None:
        base = "https://m.media-amazon.com/images/I/61abc._AC_SL1500_.jpg"
        assert preview_url(base, 400) == (
            "https://m.media-amazon.com/images/I/61abc._AC_SL400_.jpg"
        )

    def test_handles_every_token_shape_in_the_catalog(self) -> None:
        for token in ("AC_SL", "SL", "AC_UL"):
            url = f"https://m.media-amazon.com/images/I/61abc._{token}1500_.jpg"
            assert preview_url(url, 320).endswith(f"._{token}320_.jpg")

    def test_leaves_a_url_without_a_size_token_untouched(self) -> None:
        plain = "https://example.test/img/photo.jpg"
        assert preview_url(plain, 400) == plain


class TestFetchProductPhoto:
    def _client(self, handler: object) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(handler))  # type: ignore[arg-type]

    def test_returns_bytes_and_extension_on_a_good_response(self) -> None:
        client = self._client(
            lambda _r: httpx.Response(200, content=_JPEG, headers={"content-type": "image/jpeg"})
        )
        photo = fetch_product_photo(client, "https://cdn.test/a._SL1500_.jpg")

        assert photo is not None
        assert photo.extension == "jpg"
        assert photo.body == _JPEG

    def test_a_404_yields_none_rather_than_raising(self) -> None:
        # One dead url must never fail a 720-product build.
        client = self._client(lambda _r: httpx.Response(404))
        assert fetch_product_photo(client, "https://cdn.test/gone.jpg") is None

    def test_a_transport_error_yields_none(self) -> None:
        def boom(_request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route")

        assert fetch_product_photo(self._client(boom), "https://cdn.test/x.jpg") is None

    def test_a_timeout_yields_none(self) -> None:
        def slow(_request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("too slow")

        assert fetch_product_photo(self._client(slow), "https://cdn.test/x.jpg") is None

    def test_a_lying_response_yields_none_not_a_poisoned_file(self) -> None:
        client = self._client(
            lambda _r: httpx.Response(
                200, content=b"<html>blocked</html>", headers={"content-type": "image/jpeg"}
            )
        )
        assert fetch_product_photo(client, "https://cdn.test/x.jpg") is None

    def test_an_oversized_response_yields_none(self) -> None:
        client = self._client(
            lambda _r: httpx.Response(
                200,
                content=_JPEG + b"x" * MAX_IMAGE_BYTES,
                headers={"content-type": "image/jpeg"},
            )
        )
        assert fetch_product_photo(client, "https://cdn.test/x.jpg") is None

    def test_an_empty_url_is_not_fetched(self) -> None:
        def explode(_request: httpx.Request) -> httpx.Response:  # pragma: no cover
            raise AssertionError("must not issue a request for an empty url")

        assert fetch_product_photo(self._client(explode), "") is None

    def test_only_https_is_fetched(self) -> None:
        # No cleartext, and no file:// or other scheme reaching the fetcher.
        def explode(_request: httpx.Request) -> httpx.Response:  # pragma: no cover
            raise AssertionError("must not issue a request for a non-https url")

        client = self._client(explode)
        assert fetch_product_photo(client, "http://cdn.test/x.jpg") is None
        assert fetch_product_photo(client, "file:///etc/passwd") is None
