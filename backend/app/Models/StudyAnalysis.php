<?php

namespace App\Models;

class StudyAnalysis extends PrismaModel
{
    protected $table = 'StudyAnalysis';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = [
        'id', 'studyId', 'overallLiking', 'attributeStats',
        'penaltyAnalysis', 'aiInterpretation', 'aiRecommendation',
        'decisionFlag', 'generatedAt', 'updatedAt',
    ];

    protected $casts = [
        'overallLiking' => 'json',
        'attributeStats' => 'json',
        'penaltyAnalysis' => 'json',
        'generatedAt' => 'datetime',
        'updatedAt' => 'datetime',
    ];

    public function study()
    {
        return $this->belongsTo(Study::class, 'studyId');
    }
}
