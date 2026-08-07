"""Club-head tracking experiments — the 12-test evaluation
(docs/SwingSage_Club_Tracking_Comprehensive_12_Test_Plan.md).

Strictly downstream of the existing pipeline: nothing in swingsage's production stages
imports this package until a winning tracker is productionized (track step 20).
"""
from .interface import (ClubTrackingContext, ClubTrackingResult,  # noqa: F401
                        ClubTrackingTest, GOLFDB_EVENTS)
from .model import (BlurTrajectoryObservation, ClubCandidate,  # noqa: F401
                    ClubObservation, EventEvidence, KNOWN_SOURCES)
from .registry import TEST_IDS, TESTS, available, get_test, register  # noqa: F401

# Import implementations LAST so their @register decorators run on package import.
from . import tests_impl  # noqa: F401, E402
