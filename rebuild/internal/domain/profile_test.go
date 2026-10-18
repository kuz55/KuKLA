package domain

import "testing"

func TestUserProfileRequiresConsentAndValidFields(t *testing.T) {
	profile := UserProfile{UserID: "local-installation", ConsentPersonalData: true, Skills: []string{"first aid", "driver"}}
	if err := profile.Validate(); err != nil {
		t.Fatalf("valid profile rejected: %v", err)
	}

	profile.ConsentPersonalData = false
	if err := profile.Validate(); err == nil {
		t.Fatal("profile without explicit consent was accepted")
	}

	profile.ConsentPersonalData = true
	profile.BirthDate = "2035-01-01"
	if err := profile.Validate(); err == nil {
		t.Fatal("future birth date was accepted")
	}
}

func TestUserProfileRejectsBlankOrOversizedSkill(t *testing.T) {
	for _, skill := range []string{"  ", string(make([]rune, 81))} {
		profile := UserProfile{UserID: "local-installation", ConsentPersonalData: true, Skills: []string{skill}}
		if err := profile.Validate(); err == nil {
			t.Errorf("invalid skill of length %d was accepted", len([]rune(skill)))
		}
	}
}
