<?php

namespace App\Models;

class ScreeningResponse extends PrismaModel
{
    protected $table = 'ScreeningResponse';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = [
        'id', 'panelistId', 'studyId', 'responses', 'isQualified',
        'score', 'createdAt',
    ];

    protected $casts = [
        'responses' => 'json',
        'isQualified' => 'boolean',
        'score' => 'integer',
        'createdAt' => 'datetime',
    ];

    public function panelist()
    {
        return $this->belongsTo(Panelist::class, 'panelistId');
    }

    public function study()
    {
        return $this->belongsTo(Study::class, 'studyId');
    }
}
