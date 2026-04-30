Feature: Hybrid search with RRF fusion
  As a shopper
  I want hybrid search to combine keyword and vector signals
  So that semantic and exact matches both surface

  Background:
    Given the mini catalog of 50 products is loaded
    And the BM25 keyword searcher is built
    And the FAISS vector index is built

  Scenario: RRF fusion surfaces products that rank well in either backend
    When I run hybrid search for "bluetooth speaker"
    Then the top hybrid results should include products that appear in the keyword top 5
    And the top hybrid results should include products that appear in the vector top 5

  Scenario: Exact-title hybrid query still ranks the exact product highly
    When I run hybrid search for "Wireless Bluetooth Headphones"
    Then product "B001" should appear in the top 3 hybrid results
