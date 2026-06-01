<?php

namespace App\Models;

class Study extends PrismaModel
{
    protected $table = 'Study';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = [
        'id', 'creatorId', 'title', 'productName', 'category', 'stage',
        'description', 'targetDemographics', 'screeningCriteria',
        'stratificationVar', 'sampleSize', 'location', 'studyDesign',
        'status', 'createdAt', 'updatedAt',
    ];

    protected $casts = [
        'targetDemographics' => 'json',
        'screeningCriteria' => 'json',
        'sampleSize' => 'integer',
        'createdAt' => 'datetime',
        'updatedAt' => 'datetime',
    ];

    public function creator()
    {
        return $this->belongsTo(User::class, 'creatorId');
    }

    public function sensoryAttributes()
    {
        return $this->hasMany(SensoryAttribute::class, 'studyId');
    }

    public function coreAttributes()
    {
        return $this->hasMany(CoreAttribute::class, 'test_id');
    }

    public function sensoryQuestions()
    {
        return $this->hasMany(SensoryQuestion::class, 'test_id');
    }

    public function questionResponses()
    {
        return $this->hasMany(QuestionResponse::class, 'test_id');
    }

    public function derivedMetrics()
    {
        return $this->hasMany(DerivedMetric::class, 'test_id');
    }

    public function participants()
    {
        return $this->hasMany(StudyParticipant::class, 'studyId');
    }

    public function responses()
    {
        return $this->hasMany(SensoryResponse::class, 'studyId');
    }

    public function analysis()
    {
        return $this->hasOne(StudyAnalysis::class, 'studyId');
    }

    public function locationTarget()
    {
        return $this->hasOne(StudyLocationTarget::class, 'studyId');
    }

    public function screeningResponses()
    {
        return $this->hasMany(ScreeningResponse::class, 'studyId');
    }
}
