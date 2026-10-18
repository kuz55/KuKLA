package domain

import (
	"fmt"
	"strings"
	"time"
)

// UserProfile contains the non-medical part of a volunteer questionnaire.
// Medical notes are intentionally excluded until encrypted-at-rest storage is
// available for this local database.
type UserProfile struct {
	UserID                ID        `json:"user_id"`
	FullName              string    `json:"full_name,omitempty"`
	BirthDate             string    `json:"birth_date,omitempty"`
	City                  string    `json:"city,omitempty"`
	District              string    `json:"district,omitempty"`
	ExtraPhone            string    `json:"extra_phone,omitempty"`
	Skills                []string  `json:"skills"`
	HasTransport          bool      `json:"has_transport"`
	AvailableForSearches  bool      `json:"available_for_searches"`
	EmergencyContactName  string    `json:"emergency_contact_name,omitempty"`
	EmergencyContactPhone string    `json:"emergency_contact_phone,omitempty"`
	ConsentPersonalData   bool      `json:"consent_personal_data"`
	Verified              bool      `json:"verified"`
	UpdatedAt             time.Time `json:"updated_at"`
}

func (profile UserProfile) Validate() error {
	if profile.UserID == "" {
		return fmt.Errorf("%w: user id is required", ErrInvalidModel)
	}
	if !profile.ConsentPersonalData {
		return fmt.Errorf("%w: consent to local personal-data storage is required", ErrInvalidModel)
	}
	for name, value := range map[string]struct {
		text string
		max  int
	}{
		"full name":               {profile.FullName, 160},
		"city":                    {profile.City, 120},
		"district":                {profile.District, 120},
		"additional phone":        {profile.ExtraPhone, 30},
		"emergency contact name":  {profile.EmergencyContactName, 160},
		"emergency contact phone": {profile.EmergencyContactPhone, 30},
	} {
		if len([]rune(value.text)) > value.max {
			return fmt.Errorf("%w: %s exceeds %d characters", ErrInvalidModel, name, value.max)
		}
	}
	if profile.BirthDate != "" {
		birthDate, err := time.Parse("2006-01-02", profile.BirthDate)
		if err != nil || birthDate.After(time.Now().UTC()) {
			return fmt.Errorf("%w: birth date must be a valid date not in the future", ErrInvalidModel)
		}
	}
	if len(profile.Skills) > 30 {
		return fmt.Errorf("%w: no more than 30 skills may be saved", ErrInvalidModel)
	}
	for _, skill := range profile.Skills {
		if strings.TrimSpace(skill) == "" || len([]rune(skill)) > 80 {
			return fmt.Errorf("%w: each skill must contain 1 to 80 characters", ErrInvalidModel)
		}
	}
	return nil
}
