<?php

namespace App\Models;

class Panelist extends PrismaModel
{
    protected $table = 'Panelist';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = [
        'id', 'userId', 'name', 'email', 'phone', 'age', 'gender',
        'location', 'organization', 'occupation', 'lifestyle',
        'workDailyLiving', 'healthFitness', 'foodConsumption',
        'dietaryPrefs', 'consumptionHabits', 'isActive', 'isGuest',
        'joinedAt', 'lastActive',
    ];

    protected $casts = [
        'age' => 'integer',
        'lifestyle' => 'json',
        'workDailyLiving' => 'json',
        'healthFitness' => 'json',
        'foodConsumption' => 'json',
        'dietaryPrefs' => 'json',
        'consumptionHabits' => 'json',
        'isActive' => 'boolean',
        'isGuest' => 'boolean',
        'joinedAt' => 'datetime',
        'lastActive' => 'datetime',
    ];

    public function user()
    {
        return $this->belongsTo(User::class, 'userId');
    }

    public function screeningResponses()
    {
        return $this->hasMany(ScreeningResponse::class, 'panelistId');
    }

    public function participations()
    {
        return $this->hasMany(StudyParticipant::class, 'panelistId');
    }
}
