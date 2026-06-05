Feature: Flywheel retrain — recompute popularity from collected events
  As the cloud side of the flywheel
  I want to fold collected interaction events into product popularity
  So that a freshly signed bundle re-ranks engaged products higher on every edge

  Scenario: Engaged products gain popularity in the republished bundle
    Given a signed catalog bundle with two products of equal popularity
    And collected engagement that favours one product
    When the cloud retrains and republishes the bundle
    Then the republished bundle verifies under the pinned key
    And the favoured product's popularity has increased
    And the other product's popularity is unchanged
