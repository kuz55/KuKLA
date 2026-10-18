package application

import (
	"context"
	"fmt"

	"github.com/kuz55/KuKLA/rebuild/internal/domain"
)

type ProfileService struct {
	repository ProfileRepository
}

func NewProfileService(repository ProfileRepository) *ProfileService {
	return &ProfileService{repository: repository}
}

func (service *ProfileService) Get(ctx context.Context, userID domain.ID) (domain.UserProfile, error) {
	profile, err := service.repository.GetProfile(ctx, userID)
	if err != nil {
		return domain.UserProfile{}, err
	}
	return profile, nil
}

func (service *ProfileService) Save(ctx context.Context, userID domain.ID, profile domain.UserProfile) (domain.UserProfile, error) {
	if userID == "" {
		return domain.UserProfile{}, fmt.Errorf("profile owner is required")
	}
	profile.UserID = userID
	profile.Verified = false
	if err := profile.Validate(); err != nil {
		return domain.UserProfile{}, err
	}
	if err := service.repository.SaveProfile(ctx, profile); err != nil {
		return domain.UserProfile{}, err
	}
	return service.repository.GetProfile(ctx, userID)
}
