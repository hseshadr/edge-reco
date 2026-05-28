Feature: Session signal tracking
  As the recommendation engine
  I track interaction events into a session profile
  So that downstream scoring reflects the user's current intent

  Background:
    Given the mini catalog of 50 products is loaded
    And a fresh empty session profile

  Scenario: A click bumps category, tag, and brand affinity
    When I record a "click" interaction with product "B001"
    Then the session profile should have a category affinity for "Electronics" greater than 0
    And the session profile should have a tag affinity for "wireless" greater than 0
    And the session profile should have a brand affinity for "SoundMax" greater than 0

  Scenario: A favorite produces a stronger bump than a click
    When I record a "click" interaction with product "B001" in profile A
    And I record a "favorite" interaction with product "B001" in profile B
    Then profile B's category affinity for "Electronics" should be greater than profile A's

  Scenario: Recently-viewed list keeps the most recent at the front
    When I record clicks on products "B001", "B002", "B003" in order
    Then the recently-viewed list should start with "B003"
    And the recently-viewed list should contain exactly 3 entries
