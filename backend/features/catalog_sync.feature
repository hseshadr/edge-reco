Feature: Catalog sync from a signed, content-addressed bundle origin
  As an edge runtime
  I want to sync a signed bundle from an HTTP/filesystem origin
  So that the local indexes are rebuilt from verified chunks without backend roundtrips

  Scenario: Initial sync fetches every chunk and promotes the version
    Given a signed bundle origin published with a known key
    When I sync the bundle into a fresh cache
    Then every chunk is fetched and none reused
    And the active version is promoted

  Scenario: Re-syncing a changed bundle reuses unchanged chunks
    Given a signed bundle origin published with a known key
    And I have already synced it once into a cache
    When the origin republishes a bundle that shares most of its content
    And I sync the new version into the same cache
    Then at least one chunk is reused from the prior sync

  Scenario: Sync fails closed when the version pointer signature does not verify
    Given a signed bundle origin published with a known key
    When I sync the bundle with the wrong public key
    Then a signature error is raised
    And no version is promoted
