package domain

import (
	"math"
	"testing"
)

func TestKnownSearchStatuses(t *testing.T) {
	for _, status := range []SearchStatus{SearchPlanned, SearchActive, SearchPaused, SearchCompleted, SearchCancelled} {
		if !status.Valid() {
			t.Errorf("expected existing status %q to be accepted", status)
		}
	}
	if SearchStatus("UNKNOWN").Valid() {
		t.Fatal("unknown status must not be accepted")
	}
}

func TestSearchValidationPreservesTitleLengthAndOptionalCoordinates(t *testing.T) {
	valid := Search{Title: "AB", Status: SearchPlanned}
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid search rejected: %v", err)
	}
	if err := (Search{Title: "A", Status: SearchPlanned}).Validate(); err == nil {
		t.Fatal("one UTF-16 code unit must be rejected, matching the existing API minimum")
	}
	lat := 91.0
	if err := (Search{Title: "AB", Status: SearchPlanned, IncidentLat: &lat}).Validate(); err == nil {
		t.Fatal("out-of-range latitude must be rejected")
	}
}

func TestTaskPriorityAndStatus(t *testing.T) {
	for _, priority := range []int{1, 2, 3} {
		if err := (Task{Title: "T1", Status: TaskOpen, Priority: priority}).Validate(); err != nil {
			t.Errorf("priority %d rejected: %v", priority, err)
		}
	}
	if err := (Task{Title: "T1", Status: TaskOpen, Priority: 0}).Validate(); err == nil {
		t.Fatal("priority below existing range must be rejected")
	}
}

func TestPositionRequiresExplicitSourceAndValidCoordinates(t *testing.T) {
	p := Position{Lat: 54.99, Lng: 73.32, Source: PositionSimulation}
	if err := p.Validate(); err != nil {
		t.Fatalf("valid simulated position rejected: %v", err)
	}
	p.Source = ""
	if err := p.Validate(); err == nil {
		t.Fatal("missing position source must be rejected")
	}
	p.Source = PositionDevice
	p.Lat = math.NaN()
	if err := p.Validate(); err == nil {
		t.Fatal("NaN latitude must be rejected")
	}
}
