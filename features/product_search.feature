Feature: Product search
  As a shopper
  I want to find products by typing natural-language queries
  So that I can discover relevant items quickly

  Background:
    Given the mini catalog of 50 products is loaded

  Scenario: Semantic search returns relevant products
    When I search for "wireless bluetooth headphones"
    Then I should see at least one product in the Electronics category
    And the top result should mention "headphones" or "wireless" or "bluetooth"

  Scenario: Category filter narrows results
    When I search for "running" within the Clothing category
    Then every result should be in the Clothing category

  Scenario: Empty query returns no results
    When I search for ""
    Then I should see no results

  Scenario: Query with no matches returns empty
    When I search for "xyzzy quantum unicorn"
    Then I should see no results
