Feature: Catalog sync from edge server
  As an edge runtime
  I want to download a catalog from an HTTP/filesystem origin
  So that the local indexes can be (re)built without backend roundtrips

  Scenario: Initial sync downloads manifest and product file
    Given an origin with a 1-product catalog and a valid checksum
    When I sync the catalog into a fresh cache directory
    Then the local cache should contain the product file
    And the synced manifest catalog_id should match the origin

  Scenario: Sync raises when the manifest checksum does not match
    Given an origin with a 1-product catalog and a corrupted checksum
    When I attempt to sync the catalog
    Then a checksum validation error is raised
